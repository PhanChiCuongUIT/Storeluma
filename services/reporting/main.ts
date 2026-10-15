import {migrate} from '../../packages/platform/db.js';
import {start} from '../../packages/platform/http.js';
await migrate('reporting');
await start();
