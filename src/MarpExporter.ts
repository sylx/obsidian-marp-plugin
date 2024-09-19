import { exec, spawn } from "child_process";
import { App } from "obsidian";
import { getVaultDir } from "./tools";
import { writeFileSync,unlinkSync } from "fs";
import { join,basename } from "path";

export class MarpExporter {
	constructor(
		protected readonly app: App
	) {
	}
	async exportPdf(markdown: string) : Promise<Buffer> {
		//create tmp file
		const tmpFile = this.createTmpFile(markdown);

		const buffer= await new Promise<Buffer>((resolve,reject) => {
			const basedir=getVaultDir(this.app);
			const cmd=`npx -y @marp-team/marp-cli@latest --html --allow-local-files --pdf --stdin false -o - ${tmpFile}`;
			const buffer : Buffer[] = [];
			const proc = spawn(cmd,{ cwd: basedir,shell: true });
			proc.on("error",reject);
			proc.stdout.on("data",(data) => { buffer.push(Buffer.from(data)); console.log("received",data.length) });
			proc.stderr.on("data",(data) => { console.log("marp-cli",data.toString()); });
			proc.on("close",(code) => {
				if(code === 0){
					resolve(Buffer.concat(buffer));
				}
				reject(new Error(`marp-cli exited with code ${code}`));
			});
		});
		unlinkSync(tmpFile);
		return buffer;
	}
	protected createTmpFile(markdown: string): string {
		const tmpFile = join(getVaultDir(this.app),`marp-obsidian-export-${Date.now()}.md`);
		writeFileSync(tmpFile,markdown);
		return tmpFile;
	}
}
