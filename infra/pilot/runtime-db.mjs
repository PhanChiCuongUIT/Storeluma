import {createHmac} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export const applicationServices=['business','catalog','inventory','finance','sales','gateway','reporting','notification'];
export function runtimeConnection(service,ownerPassword){
  if(!applicationServices.includes(service)||!ownerPassword)throw new Error('Unknown application database');
  const password=createHmac('sha256',ownerPassword).update('storeluma-runtime:'+service).digest('hex');
  return {user:service+'_runtime',password,url:'postgres://'+service+'_runtime:'+password+'@postgres:5432/'+service+'_db'};
}
export function allowRuntime(service,ownerPassword,psql) {
  const {user,password}=runtimeConnection(service,ownerPassword);
  psql(service+'_db',`BEGIN;
    DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${user}') THEN CREATE ROLE ${user} LOGIN; END IF; END $$;
    ALTER ROLE ${user} WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOREPLICATION PASSWORD '${password}';
    GRANT CONNECT ON DATABASE ${service}_db TO ${user};
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO ${user};
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${user};
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${user};
    REVOKE ALL ON schema_migrations FROM ${user};
    GRANT SELECT ON schema_migrations TO ${user};
    COMMIT;`);
}
export function psqlInContainer(compose,env){
  return (database,sql)=>{
    try{execFileSync('docker',[...compose,'exec','-T','-u','postgres','postgres','psql','-Xq','-v','ON_ERROR_STOP=1','-d',database],{env,input:sql,stdio:['pipe','ignore','pipe']});}
    catch{throw new Error('Could not apply runtime privileges for '+database);}
  };
}
