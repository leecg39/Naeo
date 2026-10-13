import { database, transaction } from '../src/server/database';
import { audit } from '../src/server/audit';

const [command,email]=process.argv.slice(2);
if(command!=='promote'||!email) {
  console.error('Usage: npm run admin -- promote existing-account@example.com');
  process.exitCode=1;
} else {
  const db=database();
  try {
    transaction(db,()=>{
      const user=db.prepare('SELECT id,status FROM users WHERE email=?').get(email.trim().toLowerCase()) as {id:string;status:string}|undefined;
      if(!user||user.status!=='active') throw Error('An existing active account is required. Register through /login first.');
      db.prepare("UPDATE users SET role='admin',version=version+1,updated_at=? WHERE id=?").run(Date.now(),user.id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      audit(db,null,'admin.bootstrap','user',user.id,{source:'local-cli'});
      console.log('Administrator role granted to the specified account.');
    });
  } catch(error) {console.error(error instanceof Error?error.message:'Failed');process.exitCode=1;}
  finally{db.close();}
}
