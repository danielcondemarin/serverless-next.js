import { s3BucketNameFromEventRequest } from "../s3/s3BucketNameFromEventRequest";
import { buildS3RetryStrategy } from "../s3/s3RetryStrategy";
import { RegenerationEvent } from "../types";

export interface TriggerStaticRegenerationOptions {
  request: AWSLambda.CloudFrontRequest;
  basePath: string | undefined;
  pagePath: string;
  etag?: string;
  lastModified?: Date;
}

export const triggerStaticRegeneration = async (
  options: TriggerStaticRegenerationOptions
): Promise<{ throttle: boolean }> => {
  const { region } = options.request.origin?.s3 || {};
  const bucketName = s3BucketNameFromEventRequest(options.request);

  if (!bucketName) {
    throw new Error("Expected bucket name to be defined");
  }

  if (!region) {
    throw new Error("Expected region to be defined");
  }

  const { SQSClient, SendMessageCommand } = await import("@aws-sdk/client-sqs");
  const sqs = new SQSClient({
    region,
    maxAttempts: 1,
    retryStrategy: await buildS3RetryStrategy()
  });

  const regenerationEvent: RegenerationEvent = {
    region,
    bucketName,
    cloudFrontEventRequest: options.request,
    basePath: options.basePath,
    pagePath: options.pagePath
  };

  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: `https://sqs.${region}.amazonaws.com/${bucketName}.fifo`,
        MessageBody: JSON.stringify(regenerationEvent), // This is not used, however it is a required property
        // We only want to trigger the regeneration once for every previous
        // update. This will prevent the case where this page is being
        // requested again whilst its already started to regenerate.
        MessageDeduplicationId:
          options.etag || options.lastModified?.getTime()?.toString(),
        // Only deduplicate based on the object, i.e. we can generate
        // different pages in parallel, just not the same one
        MessageGroupId: options.request.uri
      })
    );
    return { throttle: false };
  } catch (error) {
    if (error.code === "RequestThrottled") {
      return { throttle: true };
    } else {
      throw error;
    }
  }
};
