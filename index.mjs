import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import mysql from 'mysql';
import beginTransaction from './beginTransaction.js';
import query from './query.js';

export const handler = async (event) => {
	if (event.httpMethod === 'OPTIONS') {
		// This is a preflight request, respond with CORS headers
		const response = {
			statusCode: 200,
			headers: {
				'Access-Control-Allow-Origin': '*',
			},
			body: JSON.stringify({ message: 'Preflight request successful' }),
		};
		return response;
	}
	console.log('==============================');
	const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
	const secret_name = "shopify_app";
	const client = new SecretsManagerClient({
		region: "ap-northeast-1",
	});
	var response = {
		statusCode: 200,
		headers: {
			'Access-Control-Allow-Origin': '*',
		},
		body: [],
	};
	// Validate request data
	if ((!body?.app_name || !body?.shopify_domain) && !body?.storefront_key_id) {
		response.statusCode = 500;
		response.body = {
			errors: [{
				code: '01',
				message: 'Invalid request.',
			}]
		};
		return response;
	}

	// Get secret from Secret manager
	var secret = {};
	try {
		secret = await client.send(
			new GetSecretValueCommand({
				SecretId: secret_name,
				VersionStage: "AWSCURRENT", // VersionStage defaults to AWSCURRENT if unspecified
			})
		);
		secret = JSON.parse(secret.SecretString);
	} catch (error) {
		console.log('error!', error);
	}

	// End process if secret is unavailable
	if (!secret?.port || !secret?.username || !secret?.password) {
		response.statusCode = 500;
		response.body = {
			errors: [{
				code: '02',
				message: 'Internal error.',
			}]
		};
		return response;
	}

	const connection = mysql.createConnection({
		// host     : secret.host,
		host: 'rds-proxy-dev.proxy-cvjdm5qq5ueh.ap-northeast-1.rds.amazonaws.com',
		port: secret.port,
		// database : secret.dbname,
		database: 'shopify_app',
		user: secret.username,
		password: secret.password
	});

	const selectSql = `
		SELECT
			storefront_key
		FROM
			storefront_api`;
	const condition_default = `
		WHERE
			app_name = '${body.app_name}'
		AND
			shopify_domain = '${body.shopify_domain}'`;
	const condition_id = `
		WHERE
		storefront_key_id = '${body.storefront_key_id}'`;
	const orderSql = `
		ORDER BY
			id
		DESC LIMIT 1;`;
	var excuteSql = selectSql;
	excuteSql += body.storefront_key_id ? condition_id : condition_default;
	excuteSql += orderSql;
	
	// Get token
	var selectResult = [];
	try {
		await beginTransaction(connection);
		selectResult = await query(connection, excuteSql);
	} catch (err) {
		console.error(err);
		response.statusCode = 500;
		response.body = {
			errors: [{
				code: '03',
				message: 'Internal error.',
			}]
		};
		return response;
	}

	// End process if token exists
	if (selectResult && selectResult.length > 0) {
		console.log('token exists ', selectResult);
		response.body = selectResult;
		return response;
	}

	return response;
};
