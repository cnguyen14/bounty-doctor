#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { diagnose, formatReport, hasToken } from "./index.js";

const program = new Command();

program
  .name("bounty-doctor")
  .description(
    "Diagnose a GitHub bounty issue before you waste hours on it: detects honeypot scam repos, AI-bot swarms, and stale contests."
  )
  .version("0.1.0");

program
  .argument("<target>", "GitHub issue URL or owner/repo#NUMBER")
  .option("--json", "emit raw JSON instead of a formatted report")
  .action(async (target: string, opts: { json?: boolean }) => {
    if (!hasToken()) {
      console.error(
        chalk.yellow(
          "warning: no GITHUB_TOKEN found and `gh auth token` did not return one. Public API rate limits apply."
        )
      );
    }
    try {
      const report = await diagnose(target);
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatReport(report));
      }
      if (report.verdict === "SCAM" || report.verdict === "AVOID") {
        process.exitCode = 2;
      }
    } catch (err) {
      console.error(chalk.red(`error: ${(err as Error).message}`));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv);
