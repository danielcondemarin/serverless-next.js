interface S3StorePageOptions {
  basePath: string | undefined;
  uri: string;
  revalidate?: number | undefined;
  bucketName: string;
  html: string;
  buildId: string;
  region: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pageData: Record<string, any>;
}

/**
 * There are multiple occasions where a static/SSG page will be generated after
 * the initial build. This function accepts a generated page, stores it and
 * applies the appropriate headers (e.g. setting an 'Expires' header for
 * regeneration).
 */
export const s3StorePage = async (
  options: S3StorePageOptions
): Promise<{ cacheControl: string | undefined; expires: Date | undefined }> => {
  const { S3Client } = await import("@aws-sdk/client-s3/S3Client");

  const s3 = new S3Client({
    region: options.region,
    maxAttempts: 3
  });

  const s3BasePath = options.basePath
    ? `${options.basePath.replace(/^\//, "")}/`
    : "";
  const baseKey = options.uri
    .replace(/^\//, "")
    .replace(/\.(json|html)$/, "")
    .replace(/^_next\/data\/[^\/]*\//, "");
  const jsonKey = `_next/data/${options.buildId}/${baseKey}.json`;
  const htmlKey = `static-pages/${options.buildId}/${baseKey}.html`;
  const cacheControl = options.revalidate
    ? undefined
    : "public, max-age=0, s-maxage=2678400, must-revalidate";
  const expires = options.revalidate
    ? new Date(new Date().getTime() + 1000 * options.revalidate)
    : undefined;

  const s3JsonParams = {
    Bucket: options.bucketName,
    Key: `${s3BasePath}${jsonKey}`,
    Body: JSON.stringify(options.pageData),
    ContentType: "application/json",
    CacheControl: cacheControl,
    Expires: expires
  };

  const s3HtmlParams = {
    Bucket: options.bucketName,
    Key: `${s3BasePath}${htmlKey}`,
    Body: options.html,
    ContentType: "text/html",
    CacheControl: cacheControl,
    Expires: expires
  };

  const { PutObjectCommand } = await import(
    "@aws-sdk/client-s3/commands/PutObjectCommand"
  );
  await Promise.all([
    s3.send(new PutObjectCommand(s3JsonParams)),
    s3.send(new PutObjectCommand(s3HtmlParams))
  ]);

  return {
    cacheControl,
    expires
  };
};
