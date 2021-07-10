import { Item } from "klaw";

export default (fileItem: Item): boolean => !fileItem.stats.isDirectory();
