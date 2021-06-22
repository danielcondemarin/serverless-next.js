import type { Readable } from "stream";
import { buildS3RetryStrategy } from "./s3RetryStrategy";

interface S3GetPageOptions {
  basePath: string | undefined;
  bucketName?: string;
  buildId: string;
  file: string;
  isData?: boolean;
  isPublicFile?: boolean;
  region?: string;
}

interface S3Page {
  bodyString: string;
  cacheControl?: string;
  contentType?: string;
  etag?: string;
  expires?: Date;
  lastModified?: Date;
}

export const s3GetPage = async (
  options: S3GetPageOptions
): Promise<S3Page | undefined> => {
  const { basePath, bucketName, buildId, isData, isPublicFile, region } =
    options;
  // Lazily import only S3Client to reduce init times until actually needed
  const { S3Client } = await import("@aws-sdk/client-s3/S3Client");

  const s3 = new S3Client({
    region,
    maxAttempts: 3,
    retryStrategy: await buildS3RetryStrategy()
  });
  const s3BasePath = basePath ? `${basePath.replace(/^\//, "")}/` : "";

  const path = isPublicFile
    ? `${s3BasePath}public/`
    : isData
    ? `${s3BasePath}`
    : `${s3BasePath}static-pages/${buildId}/`;
  const file = options.file.slice(isData || isPublicFile ? 1 : "pages/".length);
  const s3Key = `${path}${file}`;
  const { GetObjectCommand } = await import(
    "@aws-sdk/client-s3/commands/GetObjectCommand"
  );
  // S3 Body is stream per: https://github.com/aws/aws-sdk-js-v3/issues/1096
  const getStream = await import("get-stream");

  const s3Params = {
    Bucket: bucketName,
    Key: s3Key
  };

  try {
    const s3Response = await s3.send(new GetObjectCommand(s3Params));
    const bodyString = await getStream.default(s3Response.Body as Readable);
    return {
      bodyString,
      cacheControl: s3Response.CacheControl,
      contentType: s3Response.ContentType,
      etag: s3Response.ETag,
      expires: s3Response.Expires,
      lastModified: s3Response.LastModified
    };
  } catch (error) {
    return;
  }
};
