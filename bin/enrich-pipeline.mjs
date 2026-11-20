#!/usr/bin/env node
import { main } from '../src/cli.mjs';

main().catch((error) => {
	console.error(`\n✖ ${error.message}`);
	if (process.env.DEBUG) console.error(error);
	process.exitCode = 1;
});
