import React, { ChangeEvent, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type ModuleKey = 'inventory' | 'sales' | 'counts';

type ParsedRecord = {
  id: string;
  module: ModuleKey;
  source: string;
  date: string;
  brand: string;
  name: string;
  quantity: number;
  price: number;
  total: number;
  raw: string;
};

type StockTakeRow = {
  key: string;
  brand: string;
  name: string;
  price: number;
  inventory: number;
  sales: number;
  expected: number;
  counted: number;
  variance: number;
  status: 'Balanced' | 'Overage' | 'Shortage' | 'Missing Count';
  valueImpact: number;
};

type ModuleConfig = {
  key: ModuleKey;
  title: string;
  description: string;
  icon: string;
  iconClassName: string;
};

type Notice = {
  type: 'success' | 'warning' | 'error';
  message: string;
};

const modules: ModuleConfig[] = [
  {
    key: 'inventory',
    title: 'Inventory',
    description: 'Received stock records by brand, product, date, quantity, and price.',
    icon: 'fa-boxes-stacked',
    iconClassName: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  },
  {
    key: 'sales',
    title: 'Sales',
    description: 'Sales uploads organized by transaction date, product, brand, and price.',
    icon: 'fa-cash-register',
    iconClassName: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  },
  {
    key: 'counts',
    title: 'Counts',
    description: 'Physical count sheets categorized for stock-take comparison.',
    icon: 'fa-clipboard-check',
    iconClassName: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
];

const sampleFiles: Record<ModuleKey, ParsedRecord[]> = {
  inventory: [
    {
      id: 'sample-inv-1',
      module: 'inventory',
      source: 'opening-receipts.csv',
      date: '2026-05-20',
      brand: 'Acme',
      name: 'Acme Spark Plug A1',
      quantity: 120,
      price: 8.5,
      total: 1020,
      raw: 'Acme, Acme Spark Plug A1, 120, 8.50',
    },
    {
      id: 'sample-inv-2',
      module: 'inventory',
      source: 'opening-receipts.csv',
      date: '2026-05-20',
      brand: 'Nova',
      name: 'Nova Oil Filter N9',
      quantity: 80,
      price: 12.25,
      total: 980,
      raw: 'Nova, Nova Oil Filter N9, 80, 12.25',
    },
    {
      id: 'sample-inv-3',
      module: 'inventory',
      source: 'opening-receipts.csv',
      date: '2026-05-21',
      brand: 'Atlas',
      name: 'Atlas Brake Pad Pro',
      quantity: 60,
      price: 24,
      total: 1440,
      raw: 'Atlas, Atlas Brake Pad Pro, 60, 24.00',
    },
  ],
  sales: [
    {
      id: 'sample-sale-1',
      module: 'sales',
      source: 'daily-sales.xlsx',
      date: '2026-05-22',
      brand: 'Acme',
      name: 'Acme Spark Plug A1',
      quantity: 42,
      price: 8.5,
      total: 357,
      raw: '2026-05-22, Acme Spark Plug A1, 42, 8.50',
    },
    {
      id: 'sample-sale-2',
      module: 'sales',
      source: 'daily-sales.xlsx',
      date: '2026-05-23',
      brand: 'Nova',
      name: 'Nova Oil Filter N9',
      quantity: 28,
      price: 12.25,
      total: 343,
      raw: '2026-05-23, Nova Oil Filter N9, 28, 12.25',
    },
  ],
  counts: [
    {
      id: 'sample-count-1',
      module: 'counts',
      source: 'stock-count.pdf',
      date: '2026-05-24',
      brand: 'Acme',
      name: 'Acme Spark Plug A1',
      quantity: 82,
      price: 8.5,
      total: 697,
      raw: 'Count Acme Spark Plug A1 82',
    },
    {
      id: 'sample-count-2',
      module: 'counts',
      source: 'stock-count.pdf',
      date: '2026-05-24',
      brand: 'Nova',
      name: 'Nova Oil Filter N9',
      quantity: 48,
      price: 12.25,
      total: 588,
      raw: 'Count Nova Oil Filter N9 48',
    },
    {
      id: 'sample-count-3',
      module: 'counts',
      source: 'stock-count.pdf',
      date: '2026-05-24',
      brand: 'Atlas',
      name: 'Atlas Brake Pad Pro',
      quantity: 55,
      price: 24,
      total: 1320,
      raw: 'Count Atlas Brake Pad Pro 55',
    },
  ],
};

const headerAliases = {
  brand: ['brand', 'make', 'manufacturer', 'supplier'],
  name: ['name', 'product', 'item', 'description', 'sku', 'product name', 'item name'],
  quantity: ['quantity', 'qty', 'count', 'units', 'received', 'sold', 'stock', 'physical count'],
  price: ['price', 'unit price', 'rate', 'cost', 'amount', 'unit cost', 'selling price'],
  date: ['date', 'transaction date', 'received date', 'sale date', 'count date'],
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

const normalizeKey = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');

const makeProductKey = (brand: string, name: string, price: number) =>
  `${normalizeKey(brand)}|${normalizeKey(name)}|${price.toFixed(2)}`;

const parseNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return 0;
  }

  const parsed = Number(value.replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const isDateLike = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return !Number.isNaN(Date.parse(trimmed)) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(trimmed);
};

const normalizeDate = (value: unknown): string => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      const year = String(date.y).padStart(4, '0');
      const month = String(date.m).padStart(2, '0');
      const day = String(date.d).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  if (typeof value === 'string' && isDateLike(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return value.trim();
  }

  return new Date().toISOString().slice(0, 10);
};

const toTitleCase = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

const splitCsvLine = (line: string) => {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];

    if (character === '"' && nextCharacter === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }

  cells.push(current.trim());
  return cells;
};

const parseCsv = (text: string): Record<string, string>[] => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map((header) => header || `Column ${Math.random()}`);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index] ?? '';
      return row;
    }, {});
  });
};

const findValue = (row: Record<string, unknown>, aliases: string[]) => {
  const entries = Object.entries(row);
  const match = entries.find(([key]) => aliases.includes(normalizeKey(key)));
  if (match) {
    return match[1];
  }

  const looseMatch = entries.find(([key]) => {
    const normalized = normalizeKey(key);
    return aliases.some((alias) => normalized.includes(alias));
  });

  return looseMatch?.[1];
};

const inferBrand = (explicitBrand: unknown, name: string) => {
  if (typeof explicitBrand === 'string' && explicitBrand.trim()) {
    return toTitleCase(explicitBrand);
  }

  const firstToken = name.split(/\s+/).find(Boolean);
  return firstToken ? toTitleCase(firstToken) : 'Unidentified Brand';
};

const inferName = (explicitName: unknown, row: Record<string, unknown>) => {
  if (typeof explicitName === 'string' && explicitName.trim()) {
    return explicitName.trim();
  }

  const readableValue = Object.values(row)
    .map((value) => String(value ?? '').trim())
    .find((value) => /[A-Za-z]/.test(value) && !isDateLike(value) && Number.isNaN(Number(value.replace(/[$,\s]/g, ''))));

  return readableValue || 'Unidentified Product';
};

const rowToRecord = (
  row: Record<string, unknown>,
  module: ModuleKey,
  source: string,
  index: number,
): ParsedRecord => {
  const explicitName = findValue(row, headerAliases.name);
  const productName = inferName(explicitName, row);
  const brand = inferBrand(findValue(row, headerAliases.brand), productName);
  const quantity = parseNumber(findValue(row, headerAliases.quantity)) || 1;
  const price = parseNumber(findValue(row, headerAliases.price));
  const date = normalizeDate(findValue(row, headerAliases.date));
  const total = quantity * price;

  return {
    id: `${module}-${source}-${index}-${productName}`.replace(/\s+/g, '-'),
    module,
    source,
    date,
    brand,
    name: productName,
    quantity,
    price,
    total,
    raw: Object.values(row)
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
      .join(' | '),
  };
};

const parseDelimitedTextRows = (text: string) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const hasHeader = /brand|product|item|name|quantity|qty|price|date|count|sales/i.test(lines[0]);
  if (hasHeader && lines[0].includes(',')) {
    return parseCsv(text);
  }

  return lines.map((line) => {
    const commaCells = line.includes(',') ? splitCsvLine(line) : line.split(/\s{2,}|\t/).filter(Boolean);
    if (commaCells.length >= 3) {
      return {
        date: commaCells.find(isDateLike) ?? '',
        brand: commaCells[0] ?? '',
        name: commaCells[1] ?? commaCells[0] ?? '',
        quantity: commaCells[2] ?? '1',
        price: commaCells[3] ?? '0',
        raw: line,
      };
    }

    const numbers = [...line.matchAll(/[-+]?\d*\.?\d+/g)].map((match) => match[0]);
    const date = line.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/)?.[0] ?? '';
    const words = line
      .replace(date, '')
      .replace(/[-+]?\d*\.?\d+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      date,
      brand: words.split(/\s+/)[0] ?? '',
      name: words || line,
      quantity: numbers[0] ?? '1',
      price: numbers[1] ?? '0',
      raw: line,
    };
  });
};

const recordsToCsv = (records: ParsedRecord[] | StockTakeRow[]) => {
  if (!records.length) {
    return '';
  }

  const keys = Object.keys(records[0]) as Array<keyof (ParsedRecord | StockTakeRow)>;
  const escapeCell = (value: unknown) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return [keys.join(','), ...records.map((record) => keys.map((key) => escapeCell(record[key])).join(','))].join('\n');
};

const downloadBlob = (contents: string | Blob, filename: string, type?: string) => {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const summarize = (records: ParsedRecord[]) => ({
  rows: records.length,
  quantity: records.reduce((sum, record) => sum + record.quantity, 0),
  value: records.reduce((sum, record) => sum + record.total, 0),
  brands: new Set(records.map((record) => record.brand)).size,
});

const InventorySoftware: React.FC = () => {
  const [records, setRecords] = useState<ParsedRecord[]>([
    ...sampleFiles.inventory,
    ...sampleFiles.sales,
    ...sampleFiles.counts,
  ]);
  const [activeModule, setActiveModule] = useState<ModuleKey>('inventory');
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileInputRefs = {
    inventory: useRef<HTMLInputElement>(null),
    sales: useRef<HTMLInputElement>(null),
    counts: useRef<HTMLInputElement>(null),
  };

  const moduleRecords = useMemo(
    () =>
      modules.reduce<Record<ModuleKey, ParsedRecord[]>>(
        (collection, module) => {
          collection[module.key] = records
            .filter((record) => record.module === module.key)
            .sort((left, right) => left.date.localeCompare(right.date) || left.brand.localeCompare(right.brand));
          return collection;
        },
        { inventory: [], sales: [], counts: [] },
      ),
    [records],
  );

  const stockTake = useMemo(() => {
    const grouped = new Map<string, StockTakeRow>();

    records.forEach((record) => {
      const key = makeProductKey(record.brand, record.name, record.price);
      const existing =
        grouped.get(key) ??
        ({
          key,
          brand: record.brand,
          name: record.name,
          price: record.price,
          inventory: 0,
          sales: 0,
          expected: 0,
          counted: 0,
          variance: 0,
          status: 'Balanced',
          valueImpact: 0,
        } satisfies StockTakeRow);

      if (record.module === 'inventory') {
        existing.inventory += record.quantity;
      } else if (record.module === 'sales') {
        existing.sales += record.quantity;
      } else {
        existing.counted += record.quantity;
      }

      grouped.set(key, existing);
    });

    return [...grouped.values()]
      .map((row) => {
        const expected = row.inventory - row.sales;
        const variance = row.counted - expected;
        const status: StockTakeRow['status'] =
          row.counted === 0 && expected !== 0
            ? 'Missing Count'
            : variance > 0
              ? 'Overage'
              : variance < 0
                ? 'Shortage'
                : 'Balanced';

        return {
          ...row,
          expected,
          variance,
          status,
          valueImpact: variance * row.price,
        };
      })
      .sort((left, right) => left.status.localeCompare(right.status) || left.brand.localeCompare(right.brand));
  }, [records]);

  const stockSummary = useMemo(
    () => ({
      overages: stockTake.filter((row) => row.status === 'Overage').length,
      shortages: stockTake.filter((row) => row.status === 'Shortage' || row.status === 'Missing Count').length,
      balanced: stockTake.filter((row) => row.status === 'Balanced').length,
      impact: stockTake.reduce((sum, row) => sum + row.valueImpact, 0),
    }),
    [stockTake],
  );

  const parseFile = async (file: File, module: ModuleKey) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    let rows: Record<string, unknown>[] = [];

    if (extension === 'csv') {
      rows = parseCsv(await file.text());
    } else if (extension === 'xlsx' || extension === 'xls') {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      rows = workbook.SheetNames.flatMap((sheetName) =>
        XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
          defval: '',
          raw: false,
        }),
      );
    } else if (extension === 'pdf') {
      const pdf = await getDocument({ data: await file.arrayBuffer() }).promise;
      const pages: string[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
      }

      rows = parseDelimitedTextRows(pages.join('\n'));
    } else {
      throw new Error('Unsupported file type');
    }

    return rows
      .filter((row) => Object.values(row).some((value) => String(value ?? '').trim()))
      .map((row, index) => rowToRecord(row, module, file.name, index));
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>, module: ModuleKey) => {
    const files = [...(event.target.files ?? [])];
    if (!files.length) {
      return;
    }

    try {
      const parsedRecords = (await Promise.all(files.map((file) => parseFile(file, module)))).flat();
      if (!parsedRecords.length) {
        setNotice({ type: 'warning', message: 'No usable rows were found in the uploaded file.' });
        return;
      }

      setRecords((current) => [...current, ...parsedRecords]);
      setNotice({
        type: 'success',
        message: `${parsedRecords.length} ${module} rows imported from ${files.length} file(s).`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to import file.';
      setNotice({ type: 'error', message });
    } finally {
      event.target.value = '';
    }
  };

  const exportCsv = (filename: string, exportRecords: ParsedRecord[] | StockTakeRow[]) => {
    downloadBlob(recordsToCsv(exportRecords), `${filename}.csv`, 'text/csv;charset=utf-8;');
  };

  const exportExcel = (filename: string, exportRecords: ParsedRecord[] | StockTakeRow[]) => {
    const worksheet = XLSX.utils.json_to_sheet(exportRecords);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
    const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    downloadBlob(new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`);
  };

  const exportPdf = (filename: string, title: string, exportRecords: ParsedRecord[] | StockTakeRow[]) => {
    const pdf = new jsPDF({ orientation: 'landscape' });
    pdf.setFontSize(16);
    pdf.text(title, 14, 16);
    pdf.setFontSize(9);

    const rows = recordsToCsv(exportRecords).split('\n');
    rows.slice(0, 24).forEach((row, index) => {
      pdf.text(row.slice(0, 155), 14, 28 + index * 7);
    });

    if (rows.length > 24) {
      pdf.text(`Showing first 24 of ${rows.length - 1} records. Export CSV/Excel for the complete data set.`, 14, 200);
    }

    pdf.save(`${filename}.pdf`);
  };

  const activeRecords = moduleRecords[activeModule];
  const activeSummary = summarize(activeRecords);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-2 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <section className="glass-panel p-6 lg:p-8 overflow-hidden relative">
          <div className="absolute -top-24 -right-20 w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-mono text-emerald-400 uppercase tracking-[0.3em] mb-3">Stock Intelligence</p>
              <h1 className="text-3xl lg:text-5xl font-black text-white tracking-tight">Inventory Control Center</h1>
              <p className="mt-4 max-w-3xl text-sm lg:text-base text-slate-400 leading-7">
                Import CSV, PDF, and Excel files, categorize products by brand, name, and price, then reconcile
                received inventory against sales and physical count sheets.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 min-w-[260px]">
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Net Impact</p>
                <p className={`mt-2 text-2xl font-black ${stockSummary.impact >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {currencyFormatter.format(stockSummary.impact)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Products</p>
                <p className="mt-2 text-2xl font-black text-white">{stockTake.length}</p>
              </div>
            </div>
          </div>
        </section>

        {notice && (
          <div
            className={`rounded-2xl border p-4 text-sm ${
              notice.type === 'success'
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
                : notice.type === 'warning'
                  ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                  : 'border-rose-500/20 bg-rose-500/10 text-rose-200'
            }`}
          >
            {notice.message}
          </div>
        )}

        <section className="grid md:grid-cols-3 gap-4">
          {modules.map((module) => {
            const summary = summarize(moduleRecords[module.key]);
            const isActive = activeModule === module.key;

            return (
              <button
                key={module.key}
                onClick={() => setActiveModule(module.key)}
                className={`text-left rounded-2xl border p-5 transition-all ${
                  isActive
                    ? 'border-emerald-500/30 bg-emerald-500/10 shadow-lg shadow-emerald-500/5'
                    : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-slate-500">{module.title} Module</p>
                    <h2 className="mt-2 text-xl font-bold text-white">{module.title}</h2>
                  </div>
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center border ${module.iconClassName}`}>
                    <i className={`fa-solid ${module.icon}`} />
                  </div>
                </div>
                <p className="mt-3 text-sm text-slate-400 leading-6">{module.description}</p>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Rows</p>
                    <p className="text-lg font-bold text-white">{summary.rows}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Qty</p>
                    <p className="text-lg font-bold text-white">{numberFormatter.format(summary.quantity)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Brands</p>
                    <p className="text-lg font-bold text-white">{summary.brands}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </section>

        <section className="grid xl:grid-cols-[1.1fr_0.9fr] gap-6">
          <div className="glass-panel overflow-hidden">
            <div className="p-5 border-b border-white/10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.25em] text-emerald-400">{activeModule}</p>
                <h2 className="text-2xl font-bold text-white mt-1">Import, Analyze, Categorize</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRefs[activeModule]}
                  type="file"
                  multiple
                  accept=".csv,.pdf,.xls,.xlsx"
                  onChange={(event) => handleUpload(event, activeModule)}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRefs[activeModule].current?.click()}
                  className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-sm font-bold hover:bg-emerald-400 transition-colors"
                >
                  <i className="fa-solid fa-upload mr-2" />
                  Import CSV/PDF/Excel
                </button>
                <button
                  onClick={() => exportCsv(activeModule, activeRecords)}
                  className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-white/5"
                >
                  CSV
                </button>
                <button
                  onClick={() => exportExcel(activeModule, activeRecords)}
                  className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-white/5"
                >
                  Excel
                </button>
                <button
                  onClick={() => exportPdf(activeModule, `${activeModule.toUpperCase()} Report`, activeRecords)}
                  className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-white/5"
                >
                  PDF
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-0 border-b border-white/10">
              <div className="p-4 border-r border-white/10">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Total Qty</p>
                <p className="text-2xl font-black text-white mt-1">{numberFormatter.format(activeSummary.quantity)}</p>
              </div>
              <div className="p-4 border-r border-white/10">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Value</p>
                <p className="text-2xl font-black text-white mt-1">{currencyFormatter.format(activeSummary.value)}</p>
              </div>
              <div className="p-4">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Brands</p>
                <p className="text-2xl font-black text-white mt-1">{activeSummary.brands}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-950/70 text-[10px] uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Brand</th>
                    <th className="px-4 py-3 text-left">Name</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Price</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {activeRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-white/[0.03]">
                      <td className="px-4 py-3 text-slate-400 font-mono text-xs">{record.date}</td>
                      <td className="px-4 py-3 text-emerald-300">{record.brand}</td>
                      <td className="px-4 py-3 text-white">
                        <div>{record.name}</div>
                        <div className="text-[10px] text-slate-500">{record.source}</div>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-200">{numberFormatter.format(record.quantity)}</td>
                      <td className="px-4 py-3 text-right text-slate-200">{currencyFormatter.format(record.price)}</td>
                      <td className="px-4 py-3 text-right text-slate-200">{currencyFormatter.format(record.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="glass-panel p-5">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.25em] text-emerald-400">Analyzer</p>
                <h2 className="text-2xl font-bold text-white mt-1">Categorization Rules</h2>
              </div>
              <i className="fa-solid fa-wand-magic-sparkles text-emerald-400 text-2xl" />
            </div>
            <div className="space-y-4">
              {[
                ['Brand', 'Uses brand/make/manufacturer headers or the first product token.'],
                ['Name', 'Reads product, item, description, SKU, or strongest text field.'],
                ['Price', 'Normalizes currency, commas, and spreadsheet numeric cells.'],
                ['Date', 'Orders transaction content by CSV, Excel, or PDF date fields.'],
                ['Stock Take', 'Inventory received minus sales is compared with physical counts.'],
              ].map(([label, description]) => (
                <div key={label} className="rounded-2xl bg-slate-950/60 border border-white/10 p-4">
                  <p className="text-sm font-bold text-white">{label}</p>
                  <p className="text-sm text-slate-400 mt-1">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="glass-panel overflow-hidden">
          <div className="p-5 border-b border-white/10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.25em] text-emerald-400">Stock Take</p>
              <h2 className="text-2xl font-bold text-white mt-1">Inventory − Sales vs Counts</h2>
              <p className="text-sm text-slate-400 mt-2">
                Overages are counts above expected stock; shortages are counts below expected stock.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => exportCsv('stock-take', stockTake)}
                className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-white/5"
              >
                Export CSV
              </button>
              <button
                onClick={() => exportExcel('stock-take', stockTake)}
                className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-white/5"
              >
                Export Excel
              </button>
              <button
                onClick={() => exportPdf('stock-take', 'Stock Take Reconciliation', stockTake)}
                className="px-4 py-2 rounded-xl bg-white text-slate-950 text-sm font-bold hover:bg-slate-200"
              >
                Export PDF
              </button>
            </div>
          </div>

          <div className="grid md:grid-cols-4 border-b border-white/10">
            {[
              ['Balanced', stockSummary.balanced, 'text-emerald-400'],
              ['Overages', stockSummary.overages, 'text-sky-400'],
              ['Shortages', stockSummary.shortages, 'text-rose-400'],
              ['Value Impact', currencyFormatter.format(stockSummary.impact), stockSummary.impact >= 0 ? 'text-emerald-400' : 'text-rose-400'],
            ].map(([label, value, color]) => (
              <div key={label} className="p-4 border-r border-white/10 last:border-r-0">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
                <p className={`mt-1 text-2xl font-black ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/70 text-[10px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left">Brand</th>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-right">Inventory</th>
                  <th className="px-4 py-3 text-right">Sales</th>
                  <th className="px-4 py-3 text-right">Expected</th>
                  <th className="px-4 py-3 text-right">Counted</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {stockTake.map((row) => (
                  <tr key={row.key} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-3 text-emerald-300">{row.brand}</td>
                    <td className="px-4 py-3 text-white">
                      <div>{row.name}</div>
                      <div className="text-[10px] text-slate-500">{currencyFormatter.format(row.price)} unit price</div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200">{numberFormatter.format(row.inventory)}</td>
                    <td className="px-4 py-3 text-right text-slate-200">{numberFormatter.format(row.sales)}</td>
                    <td className="px-4 py-3 text-right text-slate-200">{numberFormatter.format(row.expected)}</td>
                    <td className="px-4 py-3 text-right text-slate-200">{numberFormatter.format(row.counted)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${row.variance < 0 ? 'text-rose-400' : row.variance > 0 ? 'text-sky-400' : 'text-emerald-400'}`}>
                      {numberFormatter.format(row.variance)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                          row.status === 'Balanced'
                            ? 'bg-emerald-500/10 text-emerald-300'
                            : row.status === 'Overage'
                              ? 'bg-sky-500/10 text-sky-300'
                              : 'bg-rose-500/10 text-rose-300'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

export default InventorySoftware;
