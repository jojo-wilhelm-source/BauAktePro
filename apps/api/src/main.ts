import { connect } from '@bap/db';
import { initKeys } from './auth';
import { buildApp } from './app';

await initKeys();
const app = buildApp(connect());
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
