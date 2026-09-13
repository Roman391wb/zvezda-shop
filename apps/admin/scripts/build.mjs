import {cpSync, existsSync, mkdirSync, rmSync} from "node:fs";

rmSync("dist",{recursive:true,force:true});
mkdirSync("dist",{recursive:true});
cpSync("public","dist",{recursive:true});
// Deployment may provide public/config.js as an untracked environment-specific file.
// A safe placeholder keeps the generated static bundle structurally complete otherwise.
if (!existsSync("public/config.js")) cpSync("public/config.template.js", "dist/config.js");
