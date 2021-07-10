### AWS Lambda library to help you deploy serverless next.js applications to API Gateway

## Usage

```
const path = require('path');
const { Builder } = require("@sls-next/lambda-at-edge");

const nextConfigPath = '/path/to/my/nextapp';
const outputDir = path.join(nextConfigPath, ".serverless_nextjs");

const builder = new Builder(
  nextConfigPath,
  outputDir,
  {
    cmd: './node_modules/.bin/next',
    cwd: process.cwd(),
    env: {},
    args: ['build'],
    minifyHandlers: true,
    enableHTTPCompression: false
  }
);

await builder.build()
    .then(() => {
      console.log("Application built successfully!");
    })
    .catch((e) => {
      console.log("Could not build app due the exception: ", e);
      process.exit(1);
    });
```

You can configure more options regarding building process. Configurable inputs you can find in 'build.ts' file ('packages/libs/lambda-at-edge/src/build.ts'). If you want to see debug logs during building, use 'await builder.build(true)' instead.
After running the above, the output directory will contain the Lambda@Edge handlers necessary to server side render at the edge.

```
/dir/to/my/next-app/.serverless_nextjs/

 > default-lambda
   > manifest.json
   > routes-manifest.json
   > prerender-manifest.json
   > pages/
   > index.js # handler
```

TODO:

- Separate image handler
- Handle regeneration events in current handler.
