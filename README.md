# datalake-calculation-app

## runtime nodejs16.x

1. clone repo
2. create a feature branch, do not contribute to  main branch
3. export aws credentials for deployment

export AWS_DEFAULT_REGION= XXX
export AWS_ACCESS_KEY_ID= XXX
export AWS_SECRET_ACCESS_KEY= XXX

4. Implement IaC code in `template.yaml` file.
5. Implement lambda in nodejs.16x runtime

# SAM commands

### sam build
Compiles your AWS Lambda functions and prepares them for deployment.


### sam deploy --guided (or sam deploy --capabilities CAPABILITY_NAMED_IAM)
 - Deploys your AWS SAM application to AWS.
 - The --guided flag walks you through deployment configuration.
 - After the first deployment, you can run sam deploy without --guided.

### sam validate
 -- Checks for errors in your template.yaml file.
