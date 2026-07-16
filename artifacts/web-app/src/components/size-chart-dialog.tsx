import { Ruler } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * A ready-to-wear size band. Measurements are body measurements (not garment),
 * taken from the Jalie 3891 (Tessa) size chart and grouped into the atelier's
 * XS–XL bands. `jalie` records which Jalie letter sizes each band covers.
 */
interface SizeRow {
  band: string;
  jalie: string;
  bust: { in: string; cm: string };
  waist: { in: string; cm: string };
  hip: { in: string; cm: string };
}

// Adult bands ← Jalie women's sizes R–CC.
const ADULT_SIZE_CHART: SizeRow[] = [
  {
    band: "Adult XS",
    jalie: "R–S",
    bust: { in: '33–34"', cm: "84–86" },
    waist: { in: '27–28"', cm: "69–71" },
    hip: { in: '36–37"', cm: "91–94" },
  },
  {
    band: "Adult S",
    jalie: "T–U",
    bust: { in: '35–36"', cm: "89–91" },
    waist: { in: '29–30"', cm: "74–76" },
    hip: { in: '38–39"', cm: "97–99" },
  },
  {
    band: "Adult M",
    jalie: "V–W",
    bust: { in: '37–38"', cm: "94–97" },
    waist: { in: '31–32"', cm: "79–81" },
    hip: { in: '40–41"', cm: "102–104" },
  },
  {
    band: "Adult L",
    jalie: "X–Y",
    bust: { in: '39–40"', cm: "99–102" },
    waist: { in: '33–34"', cm: "84–86" },
    hip: { in: '42–43"', cm: "107–109" },
  },
  {
    band: "Adult XL",
    jalie: "Z–CC",
    bust: { in: '41–46"', cm: "104–107" },
    waist: { in: '35–38"', cm: "89–91" },
    hip: { in: '44–47"', cm: "112–114" },
  },
];

// Child bands ← Jalie girls' sizes F–Q (approx. ages 2–13).
const CHILD_SIZE_CHART: SizeRow[] = [
  {
    band: "Child XS",
    jalie: "F–G",
    bust: { in: '21–22"', cm: "53–56" },
    waist: { in: '20–20½"', cm: "51–52" },
    hip: { in: '22–23"', cm: "56–58" },
  },
  {
    band: "Child S",
    jalie: "H–I",
    bust: { in: '23–24"', cm: "58–61" },
    waist: { in: '21–21½"', cm: "53–55" },
    hip: { in: '24–25"', cm: "61–64" },
  },
  {
    band: "Child M",
    jalie: "J–L",
    bust: { in: '25–27"', cm: "64–69" },
    waist: { in: '22–23"', cm: "56–58" },
    hip: { in: '26–28"', cm: "66–71" },
  },
  {
    band: "Child L",
    jalie: "M–N",
    bust: { in: '28–29"', cm: "71–74" },
    waist: { in: '23¾–24½"', cm: "60–62" },
    hip: { in: '29½–30½"', cm: "74–78" },
  },
  {
    band: "Child XL",
    jalie: "O–Q",
    bust: { in: '30–32"', cm: "76–81" },
    waist: { in: '25¼–26½"', cm: "64–67" },
    hip: { in: '32–34½"', cm: "81–87" },
  },
];

function MeasureCell({ value }: { value: { in: string; cm: string } }) {
  return (
    <TableCell className="whitespace-nowrap">
      <span className="text-foreground">{value.in}</span>{" "}
      <span className="text-muted-foreground/70 text-xs">{value.cm} cm</span>
    </TableCell>
  );
}

function ChartTable({ title, rows }: { title: string; rows: SizeRow[] }) {
  return (
    <div>
      <h3 className="font-serif text-xl text-foreground mb-3">{title}</h3>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-border/60">
            <TableHead className="text-foreground">Size</TableHead>
            <TableHead className="text-foreground">Bust</TableHead>
            <TableHead className="text-foreground">Waist</TableHead>
            <TableHead className="text-foreground">Hip</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.band}
              className="hover:bg-primary/5 border-border/40"
              data-testid={`size-row-${row.band.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <TableCell className="font-light">
                <span className="text-foreground">{row.band}</span>
                <span className="block text-muted-foreground/60 text-xs">
                  Jalie {row.jalie}
                </span>
              </TableCell>
              <MeasureCell value={row.bust} />
              <MeasureCell value={row.waist} />
              <MeasureCell value={row.hip} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Reusable size guide for the atelier's ready-to-wear garments. Renders a small
 * "Size Chart" trigger link; the dialog shows the Adult and Child bands with
 * their Jalie body measurements. Accessories don't use this.
 */
export function SizeChartDialog({ className }: { className?: string }) {
  return (
    <Dialog>
      <DialogTrigger
        className={cn(
          "group inline-flex items-center gap-1.5 text-xs tracking-widest uppercase text-muted-foreground hover:text-primary transition-colors",
          className,
        )}
        data-testid="link-size-chart"
      >
        <Ruler className="w-3.5 h-3.5" strokeWidth={1.5} />
        Size Chart
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl text-foreground">
            Size Guide
          </DialogTitle>
          <DialogDescription>
            Our ready-to-wear garments follow{" "}
            <span className="italic text-primary">Jalie pattern</span> sizing.
            Measure your body and choose the band closest to your bust, waist,
            and hip.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-8 mt-2">
          <ChartTable title="Adult" rows={ADULT_SIZE_CHART} />
          <ChartTable title="Children" rows={CHILD_SIZE_CHART} />
        </div>

        <p className="text-muted-foreground/70 text-xs font-light leading-relaxed mt-2">
          Between two sizes? Size up for comfort, or reach out and we'll help
          you choose. Every piece is finished to measure, so let us know your
          exact measurements when you reserve.
        </p>
      </DialogContent>
    </Dialog>
  );
}
