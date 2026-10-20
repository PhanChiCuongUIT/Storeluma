import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Req,
  Headers,
  Query,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { db, transaction } from "../../packages/platform/db.js";
import {
  nameInput,
  codeInput,
  moneyInput,
  quantityInput,
  versionInput,
  statusInput,
  idempotent,
  auditEntry,
  pageInput,
  pageResult,
} from "../../packages/platform/commands.js";
import { domainOutbox } from "../../packages/platform/events.js";
import {
  authorize,
  verifyService,
} from "../../packages/platform/service-client.js";
import type { ActorRequest } from "../../packages/platform/http.js";
const unitName = z.string().trim().min(1).max(30);
const skuInput = z
  .object({
    code: codeInput,
    name: nameInput,
    barcode: z.string().trim().min(1).max(64).nullable().default(null),
    baseUnit: unitName,
    priceVnd: moneyInput,
    attributes: z
      .object({
        color: z.string().trim().max(50).optional(),
        size: z.string().trim().max(50).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
async function category(
  c: Pick<PoolClient, "query">,
  tenant: string,
  id: string | null,
) {
  if (
    id &&
    !(
      await c.query(
        "SELECT 1 FROM categories WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
        [tenant, id],
      )
    ).rowCount
  )
    throw new NotFoundException("Nhóm hàng không tồn tại hoặc đã ngừng dùng.");
}
async function emit(c: PoolClient, row: any) {
  const p = (
    await c.query("SELECT status FROM products WHERE tenant_id=$1 AND id=$2", [
      row.tenant_id,
      row.product_id,
    ])
  ).rows[0];
  await domainOutbox(
    c,
    "catalog.sku-updated.v1",
    row.tenant_id,
    null,
    row.id,
    row.version,
    {
      skuId: row.id,
      code: row.code,
      name: row.name,
      baseUnit: row.base_unit,
      status: p.status === "ACTIVE" ? row.status : "INACTIVE",
      version: row.version,
    },
  );
}
async function createSku(
  c: PoolClient,
  tenant: string,
  product: string,
  input: z.infer<typeof skuInput>,
  actor: string,
) {
  const row = (
    await c.query(
      "INSERT INTO skus(id,tenant_id,product_id,code,name,barcode,base_unit,attributes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
      [
        randomUUID(),
        tenant,
        product,
        input.code,
        input.name,
        input.barcode,
        input.baseUnit,
        input.attributes,
      ],
    )
  ).rows[0];
  const unit = (
    await c.query(
      "INSERT INTO units(id,tenant_id,sku_id,name,factor,price_vnd,is_base) VALUES($1,$2,$3,$4,1,$5,true) RETURNING *",
      [randomUUID(), tenant, row.id, input.baseUnit, input.priceVnd],
    )
  ).rows[0];
  await c.query(
    "INSERT INTO price_history(id,tenant_id,unit_id,price_vnd,version,actor) VALUES($1,$2,$3,$4,1,$5)",
    [randomUUID(), tenant, unit.id, input.priceVnd, actor],
  );
  await auditEntry(c, tenant, actor, "SKU_CREATED", row.id, null, row);
  await emit(c, row);
  return { ...row, units: [unit] };
}
async function productDetails(tenant: string, id: string) {
  const row = (
    await db.query("SELECT * FROM products WHERE tenant_id=$1 AND id=$2", [
      tenant,
      id,
    ])
  ).rows[0];
  if (!row) throw new NotFoundException("Không tìm thấy sản phẩm.");
  const skus = (
    await db.query(
      "SELECT * FROM skus WHERE tenant_id=$1 AND product_id=$2 ORDER BY code",
      [tenant, id],
    )
  ).rows;
  const units = (
    await db.query(
      "SELECT u.* FROM units u JOIN skus s ON s.tenant_id=u.tenant_id AND s.id=u.sku_id WHERE s.tenant_id=$1 AND s.product_id=$2 ORDER BY u.is_base DESC,u.name",
      [tenant, id],
    )
  ).rows;
  return {
    ...row,
    skus: skus.map((s) => ({
      ...s,
      units: units.filter((u) => u.sku_id === s.id),
    })),
  };
}
@Controller("v1")
export class Catalog {
  @Get("tenants/:tenant/categories") async categories(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: Record<string, unknown>,
  ) {
    await authorize(r, t, "catalog.read");
    const p = pageInput(q);
    const rows = (
      await db.query(
        "SELECT * FROM categories WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::uuid IS NULL OR id>$3) AND (name ILIKE $4 OR code ILIKE $4) ORDER BY id LIMIT $5",
        [t, p.status ?? null, p.cursor ?? null, "%" + p.q + "%", p.limit + 1],
      )
    ).rows;
    return pageResult(rows, p.limit);
  }
  @Post("tenants/:tenant/categories") async createCategory(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    await authorize(r, t, "catalog.write");
    const input = z
      .object({ code: codeInput, name: nameInput })
      .strict()
      .parse(b);
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:category.create`,
        key,
        input,
        async () => {
          const row = (
            await c.query(
              "INSERT INTO categories(id,tenant_id,code,name) VALUES($1,$2,$3,$4) RETURNING *",
              [randomUUID(), t, input.code, input.name],
            )
          ).rows[0];
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "CATEGORY_CREATED",
            row.id,
            null,
            row,
          );
          return row;
        },
      ),
    );
  }
  @Patch("tenants/:tenant/categories/:id") async changeCategory(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    await authorize(r, t, "catalog.write");
    z.uuid().parse(id);
    const input = z
      .object({ name: nameInput, status: statusInput, version: versionInput })
      .strict()
      .parse(b);
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:category.${id}`,
        key,
        input,
        async () => {
          const before = (
            await c.query(
              "SELECT * FROM categories WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [t, id],
            )
          ).rows[0];
          if (!before) throw new NotFoundException("Không tìm thấy nhóm hàng.");
          if (before.version !== input.version)
            throw new ConflictException(
              "Nhóm hàng đã thay đổi. Vui lòng tải lại.",
            );
          const row = (
            await c.query(
              "UPDATE categories SET name=$3,status=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [t, id, input.name, input.status],
            )
          ).rows[0];
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "CATEGORY_UPDATED",
            id,
            before,
            row,
          );
          return row;
        },
      ),
    );
  }
  @Get("tenants/:tenant/products") async products(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: Record<string, unknown>,
  ) {
    await authorize(r, t, "catalog.read");
    const p = pageInput(q);
    const rows = (
      await db.query(
        `SELECT p.*,c.name AS category_name,(SELECT count(*)::integer FROM skus s WHERE s.tenant_id=p.tenant_id AND s.product_id=p.id) AS sku_count FROM products p LEFT JOIN categories c ON c.tenant_id=p.tenant_id AND c.id=p.category_id WHERE p.tenant_id=$1 AND ($2::text IS NULL OR p.status=$2) AND ($3::uuid IS NULL OR p.id>$3) AND (p.name ILIKE $4 OR EXISTS(SELECT 1 FROM skus s WHERE s.tenant_id=p.tenant_id AND s.product_id=p.id AND (s.code ILIKE $4 OR s.barcode ILIKE $4 OR s.name ILIKE $4))) ORDER BY p.id LIMIT $5`,
        [t, p.status ?? null, p.cursor ?? null, "%" + p.q + "%", p.limit + 1],
      )
    ).rows;
    return pageResult(rows, p.limit);
  }
  @Get("tenants/:tenant/products/:id") async product(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
  ) {
    await authorize(r, t, "catalog.read");
    z.uuid().parse(id);
    return productDetails(t, id);
  }
  @Post("tenants/:tenant/products") async createProduct(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    await authorize(r, t, "catalog.write");
    const input = z
      .object({
        name: nameInput,
        categoryId: z.uuid().nullable().default(null),
        sku: skuInput,
      })
      .strict()
      .parse(b);
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:product.create`,
        key,
        input,
        async () => {
          await category(c, t, input.categoryId);
          const row = (
            await c.query(
              "INSERT INTO products(id,tenant_id,name,category_id) VALUES($1,$2,$3,$4) RETURNING *",
              [randomUUID(), t, input.name, input.categoryId],
            )
          ).rows[0];
          const sku = await createSku(c, t, row.id, input.sku, r.actor.sub!);
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "PRODUCT_CREATED",
            row.id,
            null,
            row,
          );
          return { ...row, skus: [sku] };
        },
      ),
    );
  }
  @Patch("tenants/:tenant/products/:id") async changeProduct(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    await authorize(r, t, "catalog.write");
    z.uuid().parse(id);
    const input = z
      .object({
        name: nameInput,
        categoryId: z.uuid().nullable(),
        status: statusInput,
        version: versionInput,
      })
      .strict()
      .parse(b);
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:product.${id}`,
        key,
        input,
        async () => {
          const before = (
            await c.query(
              "SELECT * FROM products WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
              [t, id],
            )
          ).rows[0];
          if (!before) throw new NotFoundException("Không tìm thấy sản phẩm.");
          if (before.version !== input.version)
            throw new ConflictException(
              "Sản phẩm đã thay đổi. Vui lòng tải lại.",
            );
          if (input.categoryId !== before.category_id)
            await category(c, t, input.categoryId);
          const row = (
            await c.query(
              "UPDATE products SET name=$3,category_id=$4,status=$5,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [t, id, input.name, input.categoryId, input.status],
            )
          ).rows[0];
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "PRODUCT_UPDATED",
            id,
            before,
            row,
          );
          for (const sku of (
            await c.query(
              "UPDATE skus SET version=version+1,updated_at=now() WHERE tenant_id=$1 AND product_id=$2 RETURNING *",
              [t, id],
            )
          ).rows)
            await emit(c, sku);
          return row;
        },
      ),
    );
  }
  @Post("tenants/:tenant/products/:id/skus") async addSku(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    await authorize(r, t, "catalog.write");
    z.uuid().parse(id);
    const input = skuInput.parse(b);
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:sku.create.${id}`,
        key,
        input,
        async () => {
          if (
            !(
              await c.query(
                "SELECT 1 FROM products WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE' FOR SHARE",
                [t, id],
              )
            ).rowCount
          )
            throw new NotFoundException("Sản phẩm không hoạt động.");
          return createSku(c, t, id, input, r.actor.sub!);
        },
      ),
    );
  }
  @Patch("tenants/:tenant/skus/:id") async changeSku(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    await authorize(r, t, "catalog.write");
    z.uuid().parse(id);
    const input = z
      .object({
        name: nameInput,
        barcode: z.string().trim().min(1).max(64).nullable(),
        status: statusInput,
        version: versionInput,
      })
      .strict()
      .parse(b);
    return transaction((c) =>
      idempotent(c, `${t}:${r.actor.sub}:sku.${id}`, key, input, async () => {
        const old = (
          await c.query(
            "SELECT * FROM skus WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [t, id],
          )
        ).rows[0];
        if (!old) throw new NotFoundException("Không tìm thấy mã hàng.");
        if (old.version !== input.version)
          throw new ConflictException("Mã hàng đã thay đổi.");
        const row = (
          await c.query(
            "UPDATE skus SET name=$3,barcode=$4,status=$5,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
            [t, id, input.name, input.barcode, input.status],
          )
        ).rows[0];
        await auditEntry(c, t, r.actor.sub!, "SKU_UPDATED", id, old, row);
        await emit(c, row);
        return row;
      }),
    );
  }
  @Get("tenants/:tenant/skus/:id") async sku(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
  ) {
    await authorize(r, t, "catalog.read");
    z.uuid().parse(id);
    const row = (
      await db.query(
        "SELECT s.*,p.name AS product_name,p.status AS product_status FROM skus s JOIN products p ON p.tenant_id=s.tenant_id AND p.id=s.product_id WHERE s.tenant_id=$1 AND s.id=$2",
        [t, id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException("Không tìm thấy mã hàng.");
    return {
      ...row,
      units: (
        await db.query(
          "SELECT * FROM units WHERE tenant_id=$1 AND sku_id=$2 ORDER BY is_base DESC,name",
          [t, id],
        )
      ).rows,
    };
  }
  @Get("tenants/:tenant/skus") async skus(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Query() q: Record<string, unknown>,
  ) {
    await authorize(r, t, "catalog.read");
    const p = pageInput(q);
    const rows = (
      await db.query(
        `SELECT s.*,p.name AS product_name FROM skus s JOIN products p ON p.tenant_id=s.tenant_id AND p.id=s.product_id WHERE s.tenant_id=$1 AND ($2::uuid IS NULL OR s.id>$2) AND ($3::text IS NULL OR (s.status=$3 AND p.status=$3)) AND (s.name ILIKE $4 OR s.code ILIKE $4 OR s.barcode ILIKE $4) ORDER BY s.id LIMIT $5`,
        [t, p.cursor ?? null, p.status ?? null, "%" + p.q + "%", p.limit + 1],
      )
    ).rows;
    const ids = rows.map((s) => s.id),
      units = (
        await db.query(
          "SELECT * FROM units WHERE tenant_id=$1 AND sku_id=ANY($2::uuid[]) ORDER BY is_base DESC,name",
          [t, ids],
        )
      ).rows;
    return pageResult(
      rows.map((s) => ({
        ...s,
        units: units.filter((u) => u.sku_id === s.id),
      })),
      p.limit,
    );
  }
  @Post("tenants/:tenant/skus/:id/units") async addUnit(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    await authorize(r, t, "catalog.write");
    z.uuid().parse(id);
    const input = z
      .object({ name: unitName, factor: quantityInput, priceVnd: moneyInput })
      .strict()
      .parse(b);
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:unit.create.${id}`,
        key,
        input,
        async () => {
          if (
            !(
              await c.query(
                "SELECT 1 FROM skus WHERE tenant_id=$1 AND id=$2 AND status='ACTIVE'",
                [t, id],
              )
            ).rowCount
          )
            throw new NotFoundException("Mã hàng không hoạt động.");
          const row = (
            await c.query(
              "INSERT INTO units(id,tenant_id,sku_id,name,factor,price_vnd) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
              [randomUUID(), t, id, input.name, input.factor, input.priceVnd],
            )
          ).rows[0];
          await c.query(
            "INSERT INTO price_history(id,tenant_id,unit_id,price_vnd,version,actor) VALUES($1,$2,$3,$4,1,$5)",
            [randomUUID(), t, row.id, input.priceVnd, r.actor.sub],
          );
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "UNIT_CREATED",
            row.id,
            null,
            row,
          );
          await emit(
            c,
            (
              await c.query(
                "UPDATE skus SET version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
                [t, id],
              )
            ).rows[0],
          );
          return row;
        },
      ),
    );
  }
  @Patch("tenants/:tenant/skus/:id/units/:unit") async updatePrice(
    @Req() r: ActorRequest,
    @Param("tenant") t: string,
    @Param("id") id: string,
    @Param("unit") unit: string,
    @Body() b: unknown,
    @Headers("idempotency-key") key: string,
  ) {
    await authorize(r, t, "catalog.write");
    z.uuid().parse(id);
    z.uuid().parse(unit);
    const input = z
      .object({
        priceVnd: moneyInput,
        status: statusInput,
        version: versionInput,
      })
      .strict()
      .parse(b);
    return transaction((c) =>
      idempotent(
        c,
        `${t}:${r.actor.sub}:unit.${unit}`,
        key,
        input,
        async () => {
          const old = (
            await c.query(
              "SELECT * FROM units WHERE tenant_id=$1 AND sku_id=$2 AND id=$3 FOR UPDATE",
              [t, id, unit],
            )
          ).rows[0];
          if (!old) throw new NotFoundException("Không tìm thấy đơn vị.");
          if (old.version !== input.version)
            throw new ConflictException("Giá đã thay đổi. Vui lòng tải lại.");
          if (old.is_base && input.status === "INACTIVE")
            throw new ConflictException(
              "Ngừng mã hàng nếu không sử dụng đơn vị cơ sở.",
            );
          const row = (
            await c.query(
              "UPDATE units SET price_vnd=$3,status=$4,version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
              [t, unit, input.priceVnd, input.status],
            )
          ).rows[0];
          await c.query(
            "INSERT INTO price_history(id,tenant_id,unit_id,price_vnd,version,actor) VALUES($1,$2,$3,$4,$5,$6)",
            [randomUUID(), t, unit, input.priceVnd, row.version, r.actor.sub],
          );
          await auditEntry(
            c,
            t,
            r.actor.sub!,
            "UNIT_PRICE_UPDATED",
            unit,
            old,
            row,
          );
          await emit(
            c,
            (
              await c.query(
                "UPDATE skus SET version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
                [t, id],
              )
            ).rows[0],
          );
          return row;
        },
      ),
    );
  }
  @Post("internal/catalog/stock-skus") async stockSkus(
    @Req() r: ActorRequest,
    @Body() body: unknown,
  ) {
    await verifyService(r, ["inventory"]);
    const p = z
      .object({ tenantId: z.uuid(), skuIds: z.array(z.uuid()).min(1).max(100) })
      .strict()
      .parse(body);
    await authorize(r, p.tenantId, "catalog.read");
    const rows = (
      await db.query(
        "SELECT id,code,name,base_unit FROM skus WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
        [p.tenantId, p.skuIds],
      )
    ).rows;
    if (rows.length !== new Set(p.skuIds).size)
      throw new NotFoundException("Không tìm thấy mã hàng trong hộ này.");
    return rows;
  }
  @Post("internal/catalog/snapshots") async snapshots(
    @Req() r: ActorRequest,
    @Body() b: unknown,
  ) {
    await verifyService(r, ["inventory"]);
    const input = z
      .object({
        tenantId: z.uuid(),
        lines: z
          .array(z.object({ skuId: z.uuid(), unitId: z.uuid() }).strict())
          .min(1)
          .max(100),
      })
      .strict()
      .parse(b);
    await authorize(r, input.tenantId, "catalog.read");
    const rows = (
      await db.query(
        `SELECT s.id AS sku_id,s.code,s.name,s.base_unit,s.version,u.id AS unit_id,u.name AS unit_name,u.factor::text,p.name AS product_name FROM skus s JOIN units u ON u.tenant_id=s.tenant_id AND u.sku_id=s.id JOIN products p ON p.tenant_id=s.tenant_id AND p.id=s.product_id WHERE s.tenant_id=$1 AND s.id=ANY($2::uuid[]) AND s.status='ACTIVE' AND p.status='ACTIVE' AND u.status='ACTIVE'`,
        [input.tenantId, input.lines.map((l) => l.skuId)],
      )
    ).rows;
    return input.lines.map((line) => {
      const row = rows.find(
        (s) => s.sku_id === line.skuId && s.unit_id === line.unitId,
      );
      if (!row)
        throw new NotFoundException(
          "Có mã hàng hoặc đơn vị đã ngừng dùng, không thuộc hộ.",
        );
      return row;
    });
  }
}
