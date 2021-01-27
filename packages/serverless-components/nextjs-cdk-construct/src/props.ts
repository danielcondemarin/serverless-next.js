import { ICertificate } from "@aws-cdk/aws-certificatemanager";
import { Behavior, BehaviorOptions } from "@aws-cdk/aws-cloudfront";
import { Runtime } from "@aws-cdk/aws-lambda";
import { IHostedZone } from "@aws-cdk/aws-route53";
import { Duration, StackProps } from "@aws-cdk/core";

export type LambdaOption<T> =
  | T
  | { defaultLambda?: T; apiLambda?: T; imageLambda?: T };

export interface Props extends StackProps {
  /**
   * The directory that holds the output from the serverless builder.
   *
   * i.e. `serverlessBuildOutDir: new Builder(entry, outDir, {...}).outputDir`
   */
  serverlessBuildOutDir: string;
  /**
   * Is you'd like a custom domain for your site, you'll need to pass in a
   * `hostedZone`, `certificate` and full `domainName`
   */
  domain?: {
    hostedZone: IHostedZone;
    certificate: ICertificate;
    domainName: string;
  };
  /**
   * Lambda memory limit(s)
   */
  memory?: LambdaOption<number>;
  /**
   * Lambda timeout(s)
   */
  timeout?: LambdaOption<Duration>;
  /**
   * Lambda name(s)
   */
  name?: LambdaOption<string>;
  /**
   * Lambda runtimes(s)
   */
  runtime?: LambdaOption<Runtime>;
  /**
   * Enable logging on the cloudfront distribution
   */
  withLogging?: boolean;
  /**
   * Provide a list of cookies to forward to the CloudFront origin.
   *
   * This is useful if your SSR page is different based on the user requesting
   * it, so you might for example cache based on the user's authentication token.
   *
   * .e.g ['my-apps-auth-token-cookie-key']
   */
  whiteListedCookies?: string[];
  /**
   * Optionally pass one or many custom CloudFront behaviours.
   *
   * This is handy if you want to adjust how certain assets are cached, or add
   * another `lambda@edge` endpoint.
   */
  behaviours?: Record<string, BehaviorOptions>;
}
