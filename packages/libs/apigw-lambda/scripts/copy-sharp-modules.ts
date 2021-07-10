import fse from "fs-extra";
import { join } from "path";

// Ensure old contents empty before copying
fse.emptyDirSync(join(process.cwd(), "dist", "sharp_node_modules"));

// Copy sharp node_modules to the dist directory
fse.copySync(
  join(process.cwd(), "sharp_node_modules"),
  join(process.cwd(), "dist", "sharp_node_modules")
);
