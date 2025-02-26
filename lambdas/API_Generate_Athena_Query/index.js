const {DynamoDBClient} = require("@aws-sdk/client-dynamodb");
const {PutCommand, DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");


const dynamoDBClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoDBClient);
const tableName = process.env.DLC_DATA_LAKE_CONFIG_TABLE;

exports.handler = async (event) => {
    const { thingType, sensors, calculatedFields, inferences, alertConditions, timeframes } = event;
    
    // Construct TimeRanges CTE
    const timeRangesCTE = timeframes.map(tf => `
        SELECT
            '${tf} Months' AS "Month",
            to_unixtime(CAST(date_add('month', -${tf}, current_date) AS TIMESTAMP)) AS start_ts,
            to_unixtime(CAST(current_date AS TIMESTAMP)) AS end_ts
    `).join(" UNION ALL ");
    
    // Construct SELECT fields for aggregation query
    const selectFields = [
        'tr."Month"',
        'dlc."externalkey"',
        'dlc."metadata.thingtype"'
    ];
    
    // Construct fields for count query
    const countColumns = [];
    
    const processFields = (fields, prefix) => {
        for (const key in fields) {
            fields[key].forEach(func => {
                const sqlFunc = func.toUpperCase();
                if (["MIN", "MAX", "AVG"].includes(sqlFunc)) {
                    selectFields.push(`${sqlFunc}("data.${prefix}.${key}") AS "${sqlFunc.toLowerCase()}_data.${prefix}.${key}"`);
                } else if (sqlFunc === "COUNT") {
                    countColumns.push(`'data.${prefix}.${key}'`, `CAST(dlc."data.${prefix}.${key}" AS VARCHAR)`);
                }
            });
        }
    };
    
    processFields(sensors, "sensor");
    processFields(calculatedFields, "calculation");
    processFields(inferences, "sensor");
    processFields(alertConditions, "alert");
    
    console.log(`CountColumt: ${countColumns}`);

    // Construct final aggregation query
    const aggregationQuery = `
    WITH TimeRanges AS (${timeRangesCTE})
    
    SELECT 
        ${selectFields.join(",\n        ")}
    FROM 
        "default"."data_lake_calculations" dlc
    JOIN 
        TimeRanges tr ON dlc."messagetimestamp" >= tr.start_ts AND dlc."messagetimestamp" < tr.end_ts
    GROUP BY 
        tr."Month", dlc."externalkey", dlc."metadata.thingtype";`;
    
    // Construct final count query
    const countQuery = countColumns.length > 0 ? `
    WITH TimeRanges AS (${timeRangesCTE})
    
    SELECT 
        tr."Month",
        dlc."externalkey",
        dlc."metadata.thingtype",
        t.col_name,
        t.occurrences,
        COUNT(*) AS count
    FROM "default"."data_lake_calculations" dlc
    JOIN TimeRanges tr 
        ON dlc."messagetimestamp" >= tr.start_ts 
        AND dlc."messagetimestamp" < tr.end_ts
    CROSS JOIN UNNEST(
        ARRAY[${countColumns.filter((_, index) => index % 2 === 0).join(",")}],
        ARRAY[${countColumns.filter((_, index) => index % 2 === 1).join(",")}]
    ) AS t(col_name, occurrences)
    GROUP BY tr."Month", dlc."metadata.thingtype", dlc."externalkey", t.col_name, t.occurrences;` : "";
    
    console.log("Generated Aggregation Query:", aggregationQuery);
    console.log("Generated Count Query:", countQuery);
    
    const item = new PutCommand({
      TableName: tableName,
      Item: {
        "thingType": thingType,
        "input": event,
        "aggregation-query": aggregationQuery,
        "count-query": countQuery
      },
    });
  
    try {
        const response = await docClient.send(item);
        console.log("DynamoDB Response:", response);
        return response;
    } catch (error) {
        console.error("Error writing to DynamoDB:", error);
        throw error;
    }
};
