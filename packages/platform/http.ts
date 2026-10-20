import 'reflect-metadata';
import { Controller, Get, Catch, HttpException, Module, type ArgumentsHost, type ExceptionFilter, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { ZodError } from 'zod';
import { db } from './db.js';
import type { Request } from 'express';
export type ActorRequest=Request & {actor:JWTPayload};
const jwks=createRemoteJWKSet(new URL(`${process.env.OIDC_INTERNAL ?? 'http://localhost:8180/realms/storeluma'}/protocol/openid-connect/certs`));
@Injectable()
export class AuthGuard implements CanActivate{
  async canActivate(context:ExecutionContext){
    const req=context.switchToHttp().getRequest<ActorRequest>();
    if(req.path==='/health')return true;
    const value=req.headers.authorization;
    if(!value?.startsWith('Bearer '))throw new UnauthorizedException('Cần đăng nhập.');
    try{
      const {payload}=await jwtVerify(value.slice(7),jwks,{issuer:process.env.OIDC_ISSUER,audience:process.env.OIDC_AUDIENCE,algorithms:['RS256']});
      if(!payload.sub || payload.azp!=='storeluma-web')throw new Error('Invalid subject/client');
      req.actor=payload;return true;
    }catch{throw new UnauthorizedException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');}
  }
}
@Catch()
export class Errors implements ExceptionFilter{
  catch(error:unknown,host:ArgumentsHost){
    const res=host.switchToHttp().getResponse();
    if(error instanceof HttpException){const body=error.getResponse() as string|{message?:string;code?:string};res.status(error.getStatus()).json({message:typeof body==='string'?body:body.message??error.message,...(typeof body==='object'&&typeof body.code==='string'?{code:body.code}:{})});return;}
    if(error instanceof ZodError){res.status(400).json({message:'Dữ liệu không hợp lệ.',fields:error.issues.map(i=>({path:i.path.join('.'),message:i.message}))});return;}
    const code=(error as {code?:string})?.code;
    if(code==='23505'){res.status(409).json({message:'Mã đã tồn tại trong phạm vi này.'});return;}
    if(code==='22P02'||code==='23514'||code==='22003'){res.status(400).json({message:'Giá trị không hợp lệ.'});return;}
    console.error('request_failed',{name:(error as Error)?.name,code});
    res.status(500).json({message:'Không thể xử lý yêu cầu. Vui lòng thử lại.'});
  }
}
let extraReady=()=>true;
export function setReadiness(fn:()=>boolean){extraReady=fn;}
@Controller()
class Health{
  @Get('health')async health(){await db.query('SELECT 1');if(!extraReady())throw new HttpException('Message broker unavailable',503);return {service:process.env.SERVICE_NAME,status:'ok',version:'0.6.0'};}
}
export async function start(controllers:any[]=[],secure=true,configure?:(app:INestApplication)=>Promise<void>|void){
  @Module({controllers:[Health,...controllers]})class App{}
  const app=await NestFactory.create(App,{logger:['error','warn']});
  app.useGlobalFilters(new Errors());
  if(secure)app.useGlobalGuards(new AuthGuard());
  app.enableShutdownHooks();
  if(configure)await configure(app);
  await app.listen(Number(process.env.PORT??4100),'0.0.0.0');
  return app;
}
