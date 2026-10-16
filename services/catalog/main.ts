import {migrate} from '../../packages/platform/db.js';
import {start} from '../../packages/platform/http.js';
import {worker} from '../../packages/platform/bus.js';
import {Catalog} from './catalog.js';
await migrate('catalog');
await worker('catalog',[],async()=>{});
await start([Catalog]);
