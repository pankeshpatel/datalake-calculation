const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } = require("@aws-sdk/client-athena");


// Environment Variables (Set these in your AWS Lambda configuration)
const DLC_DATA_LAKE_CONFIG_TABLE = process.env.DLC_DATA_LAKE_CONFIG_TABLE;
const DLC_DATA_LAKE_METRICS_TABLE = process.env.DLC_DATA_LAKE_METRICS_TABLE;
const DLC_ATHENA_DATABASE = process.env.DLC_ATHENA_DATABASE;
const DLC_ATHENA_OUTPUT_BUCKET = `s3://${process.env.DLC_ATHENA_QUERY_RESULT_BUCKET}/`;
const DLC_ATHENA_WORKGROUP = process.env.DLC_ATHENA_WORKGROUP;
const THING_TYPE = process.env.THING_TYPE;

// Initialize clients
const dynamoDBClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoDBClient);
const athena = new AthenaClient({});

const executeAthenaQuery = async (query) => {
  try {
    const params = {
      QueryString: query,
      QueryExecutionContext: { Database: DLC_ATHENA_DATABASE },
      ResultConfiguration: { OutputLocation: DLC_ATHENA_OUTPUT_BUCKET },
      WorkGroup: DLC_ATHENA_WORKGROUP,
    };

    const command = new StartQueryExecutionCommand(params);
    const response = await athena.send(command);
    return response.QueryExecutionId;
  } catch (error) {
    console.error("Error executing Athena query:", error);
    throw new Error("Athena query execution failed");
  }
};


const checkQueryStatus = async (queryExecutionId) => {
  while (true) {
    const command = new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId });
    const response = await athena.send(command);
    const status = response.QueryExecution.Status.State;
    console.log(`Query Status: ${status}`);

    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(status)) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait before checking again
  }
};

const fetchQueryResults = async (queryExecutionId) => {
  const command = new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId });
  const results = await athena.send(command);
  return results;
};

function mergeData(aggregationData, countData) {
  if (!aggregationData?.ResultSet?.ResultRows || !countData?.ResultSet?.ResultRows) {
    console.warn("Empty query results received");
    return [];
  }
  const mergedResults = [];
  const aggRows = aggregationData.ResultSet.ResultRows.slice(1);
  const countRows = countData.ResultSet.ResultRows.slice(1);

  aggRows.forEach((aggRow) => {
      const [month, externalKey, thingType, avgPercentRemaining1, avgMinFlavorPercent, minFlavorPercent, maxFlavorPercent, minPercentRemaining2, maxPercentRemaining2] = aggRow.Data;
      
      const key = `${externalKey}__${month.replace(' ', '_').toLowerCase()}`;
      const timeframe = month.replace(" ", "_").toLowerCase();
      
      const sensors = {
          percentremaining1: { avg: parseFloat(avgPercentRemaining1) },
          percentRemaining2: {
              min: parseFloat(minPercentRemaining2),
              max: parseFloat(maxPercentRemaining2),
          },
      };
      
      const calculatedFields = {
          min_flavor_percent: {
              avg: parseFloat(avgMinFlavorPercent),
              min: parseFloat(minFlavorPercent),
              max: parseFloat(maxFlavorPercent),
          },
          flavorstate: {} // Initialize
      };
      
      const alertConditions = { low_flavor: {} }; // Initialize

      countRows.filter(row => row.Data[0] === month).forEach((row) => {
          const [, , , colName, occurrence, count] = row.Data;
          if (colName.includes("data.sensor.")) {
              const field = colName.replace("data.sensor.", "");
              if (!sensors[field]) sensors[field] = {};
              sensors[field][occurrence] = parseInt(count, 10);
          } else if (colName.includes("data.calculation.flavorstate")) {
              calculatedFields.flavorstate[occurrence] = parseInt(count, 10);
          } else if (colName.includes("data.alert.low_flavor")) {
              alertConditions.low_flavor[occurrence] = parseInt(count, 10);
          }
      });

      mergedResults.push({
          key,
          datetime: new Date().toISOString(),
          externalKey: externalKey,
          timeframe,
          thingType,
          sensors,
          calculatedFields,
          alertConditions,
      });
  });

  return mergedResults;
}


exports.handler = async (event) => {
  const command = new GetCommand({
    TableName: DLC_DATA_LAKE_CONFIG_TABLE,
    Key: {
        thingType: THING_TYPE,
    },
    });

    const response = await docClient.send(command);
    // Access thingType
    const thingType = response.Item?.thingType;

    // Access aggregation-query
    const aggregationQuery = response.Item?.["aggregation-query"];
    const countQuery = response.Item?.["count-query"];
    console.log("Thing Type:", thingType);
    console.log("Aggregation Query:", aggregationQuery);
    console.log("Count Query:", countQuery);

  try {
    // execute both aggregationQuery and countQuery
    const aggregationQueryExecutionId = await executeAthenaQuery(aggregationQuery);
    const countQueryExecutionId = await executeAthenaQuery(countQuery);
    console.log(`Aggregation Query execution ID: ${aggregationQueryExecutionId}`);
    console.log(`Count Query execution ID: ${countQueryExecutionId}`);

    const aggregationStatus = await checkQueryStatus(aggregationQueryExecutionId);
    const countStatus = await checkQueryStatus(countQueryExecutionId);

    if (aggregationStatus === "SUCCEEDED" && countStatus === "SUCCEEDED") {
        const aggregationResults = await fetchQueryResults(aggregationQueryExecutionId);
        const countResults = await fetchQueryResults(countQueryExecutionId);

        console.log("Aggregation Results:", JSON.stringify(aggregationResults, null, 2));
        console.log("Count Results:", JSON.stringify(countResults, null, 2));
        const mergedResults = mergeData(aggregationResults, countResults);
        console.log("Merged Results:", JSON.stringify(mergedResults, null, 2));

        for (const item of mergedResults) {
          console.log(`Item: ${JSON.stringify(item)}`);
          const stringifiedItem = {
            key: item.key,  
            datetime: item.datetime,  
            externalKey: item.externalKey,  
            timeframe: item.timeframe,  
            thingType: item.thingType,  
            sensors: JSON.stringify(item.sensors), 
            calculatedFields: JSON.stringify(item.calculatedFields),  
            alertConditions: JSON.stringify(item.alertConditions),  
          };
          const command = new PutCommand({
              TableName: DLC_DATA_LAKE_METRICS_TABLE,
              Item: stringifiedItem,
          });
          try {
              const response = await docClient.send(command);
              console.log(response);
          } catch (error) {
              console.error("Error inserting item:", error);
          }
        }
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Data processed successfully." })
        };
      }
    } catch (error) {
        console.error("Error processing data:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: "Failed to process data." }),
        };
    }  
};