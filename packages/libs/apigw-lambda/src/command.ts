import { default as Builder } from "./build";
import { join } from "path";

async function main(args: string[]) {
  if (args.length > 1) {
    console.error(
      "Usage: build-apigw-lambda BUCKET_NAME [ REGION ] [ NEXT_APP_DIR ]"
    );
    process.exit(1);
  }

  const bucketName = args[0];
  const region = args[1] || "us-east-1";
  const nextConfigDir = args[0] || ".";
  const outputDir = join(nextConfigDir, ".serverless_nextjs");

  const builder = new Builder(nextConfigDir, outputDir, {
    bucketName,
    region,
    cmd: "./node_modules/.bin/next",
    cwd: process.cwd(),
    env: {},
    args: ["build"]
  });

  await builder.build();
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err);
  process.exit(1);
});
