import * as core from '@actions/core'
import { EventData, EventDataSchema } from "@evnt/schema";
import { globSync, readdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findNodeAtLocation, parseTree } from "jsonc-parser";

export async function run(): Promise<void> {
	try {
		core.info("@deniz-blue/action-events-repo is running")

		const files = globSync("**/*.json", {
			withFileTypes: true,
			cwd: core.getInput("events-path") || "./events",
			exclude: ["node_modules/**", ".github/**", "dist/**", ".ls"],
		});

		core.info(`Found ${files.length} events.`)

		let errorCount = 0;
		const events = new Map<string, EventData>();

		await Promise.all(
			files.map(async (dirent) => {
				const path = join(dirent.parentPath, dirent.name);
				if (!dirent.isFile()) {
					if (dirent.isDirectory()) writeFileSync(".ls", JSON.stringify(readdirSync(path), null, 2));
					return;
				};

				const content = await readFile(path, "utf-8");
				try {
					const result = EventDataSchema.safeParse(JSON.parse(content));
					if (!result.success) {
						errorCount++;
						const json = parseTree(content);
						if (json == null) return;
						for (const issue of result.error.issues) {
							const node = findNodeAtLocation(json, issue.path as (string | number)[]);
							core.error(issue.message, {
								file: path,
								startLine: node?.offset != null ? getPosition(content, node.offset).line + 1 : undefined,
								startColumn: node?.offset != null ? getPosition(content, node.offset).column + 1 : undefined,
								endLine: node?.length != null ? getPosition(content, node.offset + node.length).line + 1 : undefined,
								endColumn: node?.length != null ? getPosition(content, node.offset + node.length).column + 1 : undefined,
							});
						}
					} else {
						events.set(path, result.data);
						core.info(`Validated event: ${path}`);
					}
				} catch (e) {
					errorCount++;
					core.error(`Failed to parse JSON in file: ${path}`, { file: path });
				}
			})
		);

		if (errorCount > 0) {
			core.setFailed(`Event data validation failed for ${errorCount} event(s).`);
			return;
		}

		core.info("Complete")
	} catch (error) {
		if (error instanceof Error) core.setFailed(error.message)
	}
}

export const getPosition = (text: string, offset: number) => {
	return {
		line: text.slice(0, offset).split('\n').length - 1,
		column: offset - text.lastIndexOf('\n', offset - 1) - 1,
	};
};
