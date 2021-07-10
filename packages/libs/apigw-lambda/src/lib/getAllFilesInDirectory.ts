import fs from "fs";
import path from "path";

const getAllFilesRecursively = (
  dirPath: string,
  arrayOfFiles: string[]
): string[] => {
  const files = fs.readdirSync(dirPath);

  files.forEach(function (file) {
    if (fs.statSync(dirPath + path.sep + file).isDirectory()) {
      arrayOfFiles = getAllFilesRecursively(
        path.join(dirPath, file),
        arrayOfFiles
      );
    } else {
      arrayOfFiles.push(path.join(dirPath, file));
    }
  });

  return arrayOfFiles;
};

const getAllFiles = (dirPath: string): string[] => {
  return getAllFilesRecursively(dirPath, []);
};

export default getAllFiles;
