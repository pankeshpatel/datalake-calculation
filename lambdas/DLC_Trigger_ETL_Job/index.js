const { GlueClient, StartJobRunCommand } = require("@aws-sdk/client-glue");

const client = new GlueClient({});

exports.handler = async (event) => {
  const params = {
    JobName: "TransformJsonToParquet", // Replace with your Glue job name
    Arguments: { // Add Arguments object
      "--year": "2025",
      "--month": "01",
      "--day": "15",
      "--hr": "17",
      "--thingType": "BEVI_Device"
    },
  };

  try {
    const command = new StartJobRunCommand(params);
    const result = await client.send(command);
    console.log("Glue job started successfully:", result);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Glue job started", runId: result.JobRunId }),
    };
  } catch (error) {
    console.error("Error starting Glue job:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Error starting Glue job", error: error.message }),
    };
  }
};