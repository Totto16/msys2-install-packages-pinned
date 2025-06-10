// webpack.config.js
const path = require("path")
const TerserPlugin = require("terser-webpack-plugin")

module.exports = {
	target: "node",
	entry: "./index.ts",
	output: {
		filename: "index.js",
		path: path.resolve(__dirname, "dist"),
	},
	mode: "production",
	resolve: {
		extensions: [".ts", ".js"],
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				use: "ts-loader",
				exclude: /node_modules/,
			},
		],
	},
	optimization: {
		minimize: true,
		minimizer: [
			new TerserPlugin({
				terserOptions: {
					format: {
						comments: false,
					},
				},
				extractComments: false,
			}),
		],
	},
}
