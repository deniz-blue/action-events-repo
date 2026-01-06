import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as core from "@actions/core";
import { EventDataSchema } from "@evnt/schema";
import type { ZodError } from "zod";
import { findNodeAtLocation, parseTree } from "jsonc-parser";

export const getPosition = (text: string, offset: number) => {
    return {
        line: text.slice(0, offset).split('\n').length - 1,
        column: offset - text.lastIndexOf('\n', offset - 1) - 1,
    };
};

class SchemaValidationError extends Error {
    constructor(public path: string, public zodError: ZodError, public fileContent: string) {
        super();
    }

    annotate() {
        const json = parseTree(this.fileContent);
        if (json == null) return;
        for (const issue of this.zodError.issues) {
            const node = findNodeAtLocation(json, issue.path as (string | number)[]);
            core.error(issue.message, {
                file: this.path,
                startLine: node?.offset != null ? getPosition(this.fileContent, node.offset).line + 1 : undefined,
                startColumn: node?.offset != null ? getPosition(this.fileContent, node.offset).column + 1 : undefined,
                endLine: node?.length != null ? getPosition(this.fileContent, node.offset + node.length).line + 1 : undefined,
                endColumn: node?.length != null ? getPosition(this.fileContent, node.offset + node.length).column + 1 : undefined,
            });
        }
    }
}

class JSONParseError extends Error {
    constructor(public path: string, public originalError: Error) {
        super();
    }

    annotate() {
        core.error(`Invalid JSON file!`, { file: this.path });
    }
}

/**
 * Task to check event data files for validity.
 * @param dir Root events directory
 */
export const checkEvents = async (dir: string) => {
    const files = globSync("**/*.json", {
        cwd: dir,
        exclude: ["node_modules/**", ".github/**", "dist/**", ".ls"],
    });

    const results = await Promise.allSettled<void>(
        files.map(async (file) => {
            if (file.startsWith(".")) return;
            const path = join(dir, file);
            const content = readFileSync(path, "utf-8");
            let json;
            try {
                json = JSON.parse(content);
            } catch (e) {
                throw new JSONParseError(path, e as Error);
            }
            const { success, error } = EventDataSchema.safeParse(json);
            if (!success) throw new SchemaValidationError(path, error as ZodError, content);
            core.info(`Validated event: ${path}`);
        })
    );

    const errors = results.filter(result => result.status === "rejected")
        .map(result => result.reason as Error);

    for (const error of errors) {
        if (error instanceof SchemaValidationError || error instanceof JSONParseError) {
            error.annotate();
        } else {
            core.error(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    if(errors.length > 0) core.setFailed(`Validation failed for ${errors.length} file(s)!`);
};
