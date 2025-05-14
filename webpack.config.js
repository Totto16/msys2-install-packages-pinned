// webpack.config.js
const path = require("path")
const TerserPlugin = require("terser-webpack-plugin")

module.exports = {
	target: "node",
	entry: "./index.js",
	output: {
		filename: "index.js",
		path: path.resolve(__dirname, "dist"),
	},
	mode: "production",
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
