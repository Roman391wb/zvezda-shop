import {rmSync} from "node:fs";
import {spawnSync} from "node:child_process";

const result=spawnSync("next",["build"],{stdio:"inherit",shell:process.platform==="win32",env:{...process.env,STATIC_STOREFRONT:"true"}});
if(result.status!==0)process.exit(result.status??1);
// Full-stack Admin remains in source, but static storefront deployment exposes no /admin output.
for(const path of ["out/admin","out/admin.html","out/admin.txt","out/_next/static/chunks/app/admin"])rmSync(path,{recursive:true,force:true});
