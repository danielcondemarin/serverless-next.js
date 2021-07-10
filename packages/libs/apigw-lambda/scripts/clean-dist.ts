import fse from "fs-extra";
import { join } from "path";

fse.emptyDirSync(join(process.cwd(), "dist"));
