import klaw, { Item } from "klaw";
import fse from "fs-extra";

const readDirectoryFiles = async (directory: string): Promise<Array<Item>> => {
  const directoryExists = await fse.pathExists(directory);
  if (!directoryExists) {
    return Promise.resolve([]);
  }

  const items: Item[] = [];
  return new Promise((resolve, reject) => {
    klaw(directory.trim())
      .on("data", (item: Item) => items.push(item))
      .on("end", () => {
        resolve(items);
      })
      .on("error", reject);
  });
};

export default readDirectoryFiles;
