import postgres from 'postgres';

let client;

function connection(env){
 if(!env.SUPABASE_DB_URL)throw new Error('Configuration PostgreSQL Supabase incomplète.');
 if(!client)client=postgres(env.SUPABASE_DB_URL,{max:1,prepare:false,ssl:'require',idle_timeout:20,connect_timeout:15});
 return client;
}

function portable(source){
 let sql=source
  .replaceAll("json_extract(o.details,'$.statusChangedAt')","(o.details::jsonb->>'statusChangedAt')")
  .replaceAll("json_extract(details,'$.source')","(details::jsonb->>'source')")
  .replaceAll("julianday(created)>julianday(?,'-1 day')","created::timestamptz > ?::timestamptz - interval '1 day'")
  .replaceAll("instr(lower(o.id||' '||o.customer||' '||o.phone),lower(?))>0","position(lower(?) in lower(o.id||' '||o.customer||' '||o.phone))>0")
  .replaceAll('ORDER BY l.rowid','ORDER BY l.id')
  .replaceAll('INSERT OR IGNORE INTO','INSERT INTO')
  .replaceAll('tracking_limits(id,window,attempts)','tracking_limits(id,"window",attempts)')
  .replaceAll('WHEN window=excluded.window','WHEN tracking_limits."window"=excluded."window"')
  .replaceAll(',window=excluded.window',',"window"=excluded."window"');
 if(source.includes('INSERT OR IGNORE INTO'))sql+=' ON CONFLICT DO NOTHING';
 let index=0,out='',quote=false;
 for(let i=0;i<sql.length;i++){
  const char=sql[i];
  if(char==="'"){
   out+=char;
   if(quote&&sql[i+1]==="'"){out+=sql[++i];continue}
   quote=!quote;continue;
  }
  if(char==='?'&&!quote)out+='$'+(++index);else out+=char;
 }
 return out;
}

function normalized(rows){
 return rows.map(row=>{
  const next={...row};
  for(const key of ['count','value','reserved','unusable'])if(typeof next[key]==='string'&&/^-?\d+$/.test(next[key]))next[key]=Number(next[key]);
  return next;
 });
}

class Prepared{
 constructor(db,sql,params=[]){this.db=db;this.sql=sql;this.params=params}
 bind(...params){return new Prepared(this.db,this.sql,params)}
 async execute(){return this.db.unsafe(portable(this.sql),this.params)}
 async all(){const rows=await this.execute();return {results:normalized(rows),meta:{changes:rows.count||0}}}
 async first(){return (await this.all()).results[0]||null}
 async run(){const rows=await this.execute();return {results:normalized(rows),meta:{changes:rows.count||0}}}
}

export function supabaseDatabase(env){
 const sql=connection(env);
 return {
  prepare(statement){return new Prepared(sql,statement)},
  async batch(items){
   return sql.begin(async transaction=>{
    const results=[];let previousChanges=0;
    for(const item of items){
     if(item.sql.includes('WHERE changes()=0')){
      if(previousChanges===0)throw new Error('Concurrent modification detected.');
      results.push({results:[],meta:{changes:0}});continue;
     }
     const rows=await transaction.unsafe(portable(item.sql),item.params);
     previousChanges=rows.count||0;
     results.push({results:normalized(rows),meta:{changes:previousChanges}});
    }
    return results;
   });
  }
 };
}
