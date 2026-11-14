#!/usr/bin/env python3
import os,sys,json,hashlib,tempfile,subprocess,pathlib,datetime,time,boto3
from botocore.config import Config
TABLES=('users','chat_workspaces','chat_memberships','branches','chat_workspace_branches','products','ingredients','product_ingredients','sales','sale_items','branch_products','branch_ingredients','branch_recipes','starter_catalog_templates','branch_catalog_provisioning')
VARS=('DATABASE_URL','BACKUP_ENDPOINT','BACKUP_BUCKET','BACKUP_REGION','BACKUP_ACCESS_KEY_ID','BACKUP_SECRET_ACCESS_KEY')
def info(event,**kw):print(json.dumps(dict(event=event,**kw)),flush=True)
def run(args,label):
    seconds=80 if label=='scratch postgres start' else 1200
    p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=seconds)
    if p.returncode:raise RuntimeError(label+' failed; exit '+str(p.returncode))
    return p.stdout.strip()
def main():
    missing=[x for x in VARS if not os.getenv(x)]
    if missing:raise RuntimeError('Unset variables: '+','.join(missing))
    os.environ['PGCONNECT_TIMEOUT']='15'
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    with tempfile.TemporaryDirectory(prefix='donmac-db-') as folder:
        dump=pathlib.Path(folder)/'database.dump'
        store=pathlib.Path(folder)/'localpostgres'
        info('backup-start',timestamp=stamp)
        run(['pg_dump','-Fc','--no-owner','--no-acl','-f',str(dump),'-d',os.environ['DATABASE_URL']],'pg_dump')
        info('archive-created',bytes=dump.stat().st_size)
        if dump.stat().st_size<1024:raise RuntimeError('Dump unexpectedly small')
        entries=run(['pg_restore','--list',str(dump)],'archive listing')
        missing=[x for x in TABLES if not any('TABLE public '+x+' ' in l for l in entries.splitlines())]
        if missing:raise RuntimeError('Missing tables: '+','.join(missing))
        info('archive-toc-verified',tables=len(TABLES))
        sha=hashlib.sha256(dump.read_bytes()).hexdigest()
        run(['initdb','--auth=trust','-D',str(store)],'scratch initdb')
        info('scratch-initialized')
        port='55432'
        try:
            info('scratch-starting')
            run(['pg_ctl','-D',str(store),'-o','-p '+port+' -k /tmp -c listen_addresses=127.0.0.1','-w','start'],'scratch postgres start')
            info('scratch-started')
            run(['createdb','-h','/tmp','-p',port,'-U','postgres','restore_test'],'create restore test DB')
            run(['pg_restore','--single-transaction','--exit-on-error','--no-owner','--no-acl','-h','/tmp','-p',port,'-U','postgres','-d','restore_test',str(dump)],'full restore')
            info('scratch-restored')
            counts={}
            for t in TABLES:
                counts[t]=int(run(['psql','-h','/tmp','-p',port,'-U','postgres','-d','restore_test','-tA','-c','SELECT COUNT(*) FROM "'+t+'"'],'table integrity'))
            invalid=int(run(['psql','-h','/tmp','-p',port,'-U','postgres','-d','restore_test','-tA','-c','SELECT COUNT(*) FROM branch_recipes r LEFT JOIN branch_products p ON p.id=r.product_id AND p.workspace_id=r.workspace_id AND p.branch_id=r.branch_id LEFT JOIN branch_ingredients i ON i.id=r.ingredient_id AND i.workspace_id=r.workspace_id AND i.branch_id=r.branch_id WHERE p.id IS NULL OR i.id IS NULL'],'recipe integrity'))
            if invalid or (counts['sales'] and not counts['sale_items']):
                raise RuntimeError('Restore integrity verification failed')
            info('restore-verified',sales=counts['sales'],branchIngredients=counts['branch_ingredients'],tables=len(counts))
        finally:
            subprocess.run(['pg_ctl','-D',str(store),'-m','immediate','stop'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=45,check=False)
        client=boto3.client('s3',endpoint_url=os.environ['BACKUP_ENDPOINT'],region_name=os.environ['BACKUP_REGION'],aws_access_key_id=os.environ['BACKUP_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['BACKUP_SECRET_ACCESS_KEY'],config=Config(s3={'addressing_style':'virtual'}))
        bucket=os.environ['BACKUP_BUCKET'];key='verified-postgres/'+stamp+'.dump'
        client.upload_file(str(dump),bucket,key,ExtraArgs={'ContentType':'application/octet-stream','Metadata':{'sha256':sha}})
        fetched=pathlib.Path(folder)/'fetched.dump'
        client.download_file(bucket,key,str(fetched))
        if hashlib.sha256(fetched.read_bytes()).hexdigest()!=sha:raise RuntimeError('Uploaded archive checksum mismatch')
        client.put_object(Bucket=bucket,Key=key+'.json',Body=json.dumps({'timestamp':stamp,'sha256':sha,'bytes':dump.stat().st_size,'restored':True,'tables':counts}).encode(),ContentType='application/json')
        info('independent-backup-verified',key=key,bytes=dump.stat().st_size,sha256=sha[:16])
if __name__=='__main__':
    try:main();time.sleep(12)
    except Exception as err:
        info('backup-failed',reason=str(err)[:270]);time.sleep(18);sys.exit(1)
