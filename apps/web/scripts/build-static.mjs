import {cpSync,mkdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";

const repository=process.env.GITHUB_REPOSITORY||"REPLACE_WITH_GITHUB_OWNER/REPOSITORY";
const authBaseUrl=process.env.CMS_AUTH_BASE_URL||"REPLACE_WITH_CLOUDFLARE_WORKER_URL";
const template=readFileSync("public/admin/config.template.yml","utf8");
mkdirSync("public/admin",{recursive:true});
writeFileSync("public/admin/config.yml",template.replaceAll("__GITHUB_REPOSITORY__",repository).replaceAll("__CMS_AUTH_BASE_URL__",authBaseUrl));

const result=spawnSync("next",["build"],{stdio:"inherit",shell:process.platform==="win32",env:{...process.env,STATIC_STOREFRONT:"true"}});
if(result.status!==0)process.exit(result.status??1);
// Full-stack React admin remains in source. Replace only its generated route with
// the standalone Git CMS; its application chunks are removed from the public output.
for(const path of ["out/admin","out/admin.html","out/admin.txt","out/_next/static/chunks/app/admin"])rmSync(path,{recursive:true,force:true});
cpSync("public/admin","out/admin",{recursive:true});
