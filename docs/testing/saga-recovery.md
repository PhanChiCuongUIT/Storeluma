# Checkout and return recovery

Run `npx playwright test tests/week11-saga.spec.ts` on a dedicated Compose stack. The suite creates a household, a location, opening stock and a cash shift through the public APIs. Each sale uses one item priced at VND 100,000 with a cost of VND 40,000.

| Case | Interruption | Evidence after recovery |
| --- | --- | --- |
| W11-05 | Finance has collected cash. Its successful payment status reply is lost before Sales reads it. | Sales records REVIEW, queries the same payment and completes the sale with one cash entry and one stock movement. |
| W11-06 | Sales exits after Inventory commits the reservation and before Sales records the result. | The replacement worker finishes the same order with the original reservation, cost and payment. |
| W11-07 | A worker receives the stock commit reply after its claim expires. | Its failed read leaves the claim token, version and stage intact until another worker takes over. |
| W11-08 | A second Sales worker completes the order while the first still holds a delayed reply. | Resuming the first worker preserves the final version, one completion event and the recorded money and stock. |
| W11-09 | Inventory receives half an item into quarantine. Sales exits before recording receipt or creating the refund. | The return resumes with its original refund ID. Cash confirmation posts one VND 50,000 refund and the stock movement records half an item worth VND 20,000. |
| W11-10 | The return worker holds the receipt reply until its lease expires. | The expired worker leaves the claim and retry count intact. The replacement finishes the return with one quarantine movement and one cash refund. |

The test worker runs the compiled Sales workflow against the stack's Finance and Inventory services. It interrupts a successful HTTP reply for one document. The two crash cases use SIGKILL. The lease tests wait for PostgreSQL's clock or for the replacement worker to finish before releasing the delayed response. Assertions read each service's records with its own database account. Each test restores the regular Sales container.
