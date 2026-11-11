// Finance actions on settlement batches, until the admin console (prompt 20) exists.
// Run inside the API container (an ECS one-off task in production; access via AWS IAM):
//   node dist/src/cli/finance.js list
//   node dist/src/cli/finance.js approve --admin-phone +91XXXXXXXXXX --reason "Checked" <batchId> [batchId...]
//   node dist/src/cli/finance.js export --admin-phone +91XXXXXXXXXX --reason "Bank upload" --out payouts.csv
//   node dist/src/cli/finance.js re-export --admin-phone +91XXXXXXXXXX --reason "File lost" --out again.csv <batchId>...
//   node dist/src/cli/finance.js mark-paid --admin-phone +91XXXXXXXXXX --reason "Sent" --reference UTR123 <batchId>
// Every action needs an active admin and a reason, and is written to admin_audit_logs.
import './no-workers.js';
import '../instrument.js';
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

async function main(): Promise<void> {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module.js');
  const { FinanceService } = await import('../modules/ledger/finance.service.js');
  const { PrismaService } = await import('../prisma/prisma.service.js');

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'admin-phone': { type: 'string' },
      reason: { type: 'string' },
      reference: { type: 'string' },
      out: { type: 'string' },
    },
  });
  const [command, ...ids] = positionals;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const finance = app.get(FinanceService);
    const need = (k: 'admin-phone' | 'reason') => {
      const v = values[k];
      if (!v) throw new Error(`--${k} is required`);
      return v;
    };
    const needOut = () => {
      if (!values.out) throw new Error('--out is required');
      // Fails if the file exists (never overwrite an earlier export) or the folder isn't writable.
      writeFileSync(values.out, '', { flag: 'wx' });
      return values.out;
    };
    switch (command) {
      case 'list': {
        const batches = await app.get(PrismaService).settlementBatch.findMany({
          where: { status: { in: ['pending_approval', 'approved', 'exported'] } },
          orderBy: [{ status: 'asc' }, { businessDay: 'asc' }],
        });
        if (batches.length === 0) console.log('No batches waiting.');
        for (const b of batches) {
          console.log(
            `${b.id}  ${b.businessDay.toISOString().slice(0, 10)}  ${b.status.padEnd(16)} net ₹${Number(b.netPaise) / 100}`,
          );
        }
        break;
      }
      case 'approve':
        console.log(
          `Approved ${await finance.approve({ batchIds: ids, adminPhone: need('admin-phone'), reason: need('reason') })} batch(es)`,
        );
        break;
      case 'export': {
        // The file is created BEFORE any batch changes status, so a bad path can't lose the export.
        const out = needOut();
        const csv = await finance.exportCsv({
          adminPhone: need('admin-phone'),
          reason: need('reason'),
        });
        writeFileSync(out, csv);
        console.log(`Wrote ${out}`);
        break;
      }
      case 're-export': {
        const out = needOut();
        const csv = await finance.reexportCsv({
          batchIds: ids,
          adminPhone: need('admin-phone'),
          reason: need('reason'),
        });
        writeFileSync(out, csv);
        console.log(`Wrote ${out}`);
        break;
      }
      case 'mark-paid':
        if (ids.length !== 1 || !values.reference)
          throw new Error('mark-paid needs one batch id and --reference');
        await finance.markPaid({
          batchId: ids[0]!,
          adminPhone: need('admin-phone'),
          reference: values.reference,
          reason: need('reason'),
        });
        console.log(`Marked ${ids[0]} paid`);
        break;
      default:
        throw new Error('Commands: list, approve, export, re-export, mark-paid');
    }
  } finally {
    await app.close();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
