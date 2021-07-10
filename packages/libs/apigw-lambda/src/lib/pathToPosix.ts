const pathToPosix = (path: string): string => path.replace(/\\/g, "/");
export default pathToPosix;
