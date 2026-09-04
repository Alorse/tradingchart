"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  useChartStore,
  DEFAULT_CONFIG,
  DEFAULT_ADX_STYLE,
  DEFAULT_SQUEEZE_STYLE,
  DEFAULT_KEY_LEVELS,
  DEFAULT_BOLLINGER_STYLE,
  DEFAULT_VWAP_STYLE,
  DEFAULT_VOLUME_PROFILE,
  type IndicatorKey,
  type IndicatorConfig,
  type AdxStyle,
  type UserEMA,
  type SqueezeStyle,
  type KeyLevelsConfig,
  type VolumeProfileConfig,
} from "@/lib/store/chart-store";

const TITLES: Record<IndicatorKey, string> = {
  rsi: "RSI",
  macd: "MACD",
  volume: "Volume",
  adx: "ADX",
  squeeze: "Squeeze Momentum",
  vumanchu: "VuManChu Cipher B",
  obv: "On-Balance Volume",
  keylevels: "Key Levels (W,M,Q,Y)",
  bb: "Bollinger Bands",
  vwap: "VWAP",
  vrvp: "Volume Profile (Visible Range)",
  stochrsi: "Stochastic RSI",
  williamsr: "Williams %R",
  atr: "Average True Range",
  cci: "Commodity Channel Index",
  mfi: "Money Flow Index",
};

export function IndicatorSettingsDialog() {
  const target = useChartStore((s) => s.settingsTarget);
  const setTarget = useChartStore((s) => s.setSettingsTarget);
  const config = useChartStore((s) => s.config);
  const setConfig = useChartStore((s) => s.setConfig);
  const userEMAs = useChartStore((s) => s.userEMAs);
  const updateUserEMA = useChartStore((s) => s.updateUserEMA);

  const open = target !== null;
  const isEMA = typeof target === "object" && target !== null && target.kind === "ema";
  const emaInstance = isEMA ? userEMAs.find((e) => e.id === target.id) ?? null : null;

  const indicatorKey = !isEMA && target ? (target as IndicatorKey) : null;
  const titleText = isEMA
    ? `EMA ${emaInstance?.period ?? ""}`
    : indicatorKey
      ? TITLES[indicatorKey]
      : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setTarget(null);
      }}
    >
      <DialogContent className="max-w-sm bg-tv-panel">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">
            {titleText} — Settings
          </DialogTitle>
        </DialogHeader>
        {isEMA && emaInstance && (
          <EMAForm
            instance={emaInstance}
            onSave={(patch) => {
              updateUserEMA(emaInstance.id, patch);
              setTarget(null);
            }}
            onClose={() => setTarget(null)}
          />
        )}
        {indicatorKey && (
          <SettingsForm
            target={indicatorKey}
            config={config}
            onSave={(patch) => {
              setConfig(patch);
              setTarget(null);
            }}
            onReset={() => {
              setConfig(DEFAULT_CONFIG);
              setTarget(null);
            }}
            onClose={() => setTarget(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EMAForm({
  instance,
  onSave,
  onClose,
}: {
  instance: UserEMA;
  onSave: (patch: Partial<UserEMA>) => void;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState(instance.period);
  const [color, setColor] = useState(instance.color);
  const [lineWidth, setLineWidth] = useState(instance.lineWidth);

  useEffect(() => {
    setPeriod(instance.period);
    setColor(instance.color);
    setLineWidth(instance.lineWidth);
  }, [instance]);

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Period"
        value={period}
        min={2}
        max={500}
        onChange={(n) => setPeriod(n)}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
          Color
        </span>
        <ColorPicker value={color} onChange={(v) => setColor(v)} />
      </div>
      <label className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
          Line width
        </span>
        <div className="flex items-center gap-1">
          {[1, 2, 3].map((w) => (
            <button
              key={w}
              onClick={() => setLineWidth(w)}
              className={`h-6 w-6 rounded text-[10px] ${
                lineWidth === w
                  ? "bg-tv-blue/20 text-tv-blue-text"
                  : "text-tv-text-muted hover:bg-tv-panel-hover"
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </label>

      <div className="mt-2 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-tv-text-muted hover:text-tv-text"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() =>
            onSave({
              period: clamp(period, 2, 500),
              color,
              lineWidth,
            })
          }
          className="bg-tv-blue hover:bg-tv-blue/90"
        >
          Apply
        </Button>
      </div>
    </div>
  );
}

interface FormProps {
  target: IndicatorKey;
  config: IndicatorConfig;
  onSave: (patch: Partial<IndicatorConfig>) => void;
  onReset: () => void;
  onClose: () => void;
}

/**
 * Indicators whose settings live in their own store slice, not in
 * `IndicatorConfig`, and are applied the moment they change. They get a plain
 * "Done" instead of the Reset/Apply pair: there is no draft for Apply to
 * commit, and the shared "Reset defaults" resets the *whole* IndicatorConfig —
 * so pressing it from here would silently wipe the RSI, MACD and ADX periods.
 */
const LIVE_APPLY_TARGETS = new Set<IndicatorKey>(["vrvp", "keylevels"]);

function SettingsForm({ target, config, onSave, onReset, onClose }: FormProps) {
  const [draft, setDraft] = useState({
    rsi: config.rsi,
    macdFast: config.macdFast,
    macdSlow: config.macdSlow,
    macdSignal: config.macdSignal,
    adx: config.adx,
    adxDiLen: config.adxDiLen,
    adxKeyLevel: config.adxKeyLevel,
    squeezeBB: config.squeezeBB,
    squeezeBBMult: config.squeezeBBMult,
    squeezeKC: config.squeezeKC,
    squeezeKCMult: config.squeezeKCMult,
    bbPeriod: config.bbPeriod,
    bbMult: config.bbMult,
    bbMaType: config.bbMaType,
    vwapAnchor: config.vwapAnchor,
    vwapBandMult: config.vwapBandMult,
    stochRsiLen: config.stochRsiLen,
    stochRsiStochLen: config.stochRsiStochLen,
    stochRsiK: config.stochRsiK,
    stochRsiD: config.stochRsiD,
    williamsRPeriod: config.williamsRPeriod,
    atrPeriod: config.atrPeriod,
    cciPeriod: config.cciPeriod,
    mfiPeriod: config.mfiPeriod,
  });

  useEffect(() => {
    setDraft({
      rsi: config.rsi,
      macdFast: config.macdFast,
      macdSlow: config.macdSlow,
      macdSignal: config.macdSignal,
      adx: config.adx,
      adxDiLen: config.adxDiLen,
      adxKeyLevel: config.adxKeyLevel,
      squeezeBB: config.squeezeBB,
      squeezeBBMult: config.squeezeBBMult,
      squeezeKC: config.squeezeKC,
      squeezeKCMult: config.squeezeKCMult,
      bbPeriod: config.bbPeriod,
      bbMult: config.bbMult,
      bbMaType: config.bbMaType,
      vwapAnchor: config.vwapAnchor,
      vwapBandMult: config.vwapBandMult,
      stochRsiLen: config.stochRsiLen,
      stochRsiStochLen: config.stochRsiStochLen,
      stochRsiK: config.stochRsiK,
      stochRsiD: config.stochRsiD,
      williamsRPeriod: config.williamsRPeriod,
      atrPeriod: config.atrPeriod,
      cciPeriod: config.cciPeriod,
      mfiPeriod: config.mfiPeriod,
    });
  }, [config, target]);

  function save() {
    if (target === "rsi") onSave({ rsi: clamp(draft.rsi, 2, 100) });
    else if (target === "macd")
      onSave({
        macdFast: clamp(draft.macdFast, 2, 100),
        macdSlow: clamp(draft.macdSlow, 2, 200),
        macdSignal: clamp(draft.macdSignal, 2, 100),
      });
    else if (target === "adx")
      onSave({
        adx: clamp(draft.adx, 2, 100),
        adxDiLen: clamp(draft.adxDiLen, 2, 100),
        adxKeyLevel: clamp(draft.adxKeyLevel, 1, 100),
      });
    else if (target === "squeeze")
      onSave({
        squeezeBB: clamp(draft.squeezeBB, 2, 200),
        squeezeBBMult: clamp(draft.squeezeBBMult, 0.1, 10),
        squeezeKC: clamp(draft.squeezeKC, 2, 200),
        squeezeKCMult: clamp(draft.squeezeKCMult, 0.1, 10),
      });
    else if (target === "bb")
      onSave({
        bbPeriod: clamp(draft.bbPeriod, 2, 500),
        bbMult: clamp(draft.bbMult, 0.1, 10),
        bbMaType: draft.bbMaType,
      });
    else if (target === "vwap")
      onSave({
        vwapAnchor: draft.vwapAnchor,
        vwapBandMult: clamp(draft.vwapBandMult, 0.1, 10),
      });
    else if (target === "stochrsi")
      onSave({
        stochRsiLen: clamp(draft.stochRsiLen, 2, 200),
        stochRsiStochLen: clamp(draft.stochRsiStochLen, 2, 200),
        stochRsiK: clamp(draft.stochRsiK, 1, 50),
        stochRsiD: clamp(draft.stochRsiD, 1, 50),
      });
    else if (target === "williamsr") onSave({ williamsRPeriod: clamp(draft.williamsRPeriod, 2, 500) });
    else if (target === "atr") onSave({ atrPeriod: clamp(draft.atrPeriod, 2, 500) });
    else if (target === "cci") onSave({ cciPeriod: clamp(draft.cciPeriod, 2, 500) });
    else if (target === "mfi") onSave({ mfiPeriod: clamp(draft.mfiPeriod, 2, 500) });
    else if (target === "volume") onSave({});
  }

  return (
    <div className="flex flex-col gap-3">
      {target === "rsi" && (
        <>
          <Field
            label="Period"
            value={draft.rsi}
            onChange={(n) => setDraft((d) => ({ ...d, rsi: n }))}
          />
          <OverlaySection target="rsi" />
        </>
      )}
      {target === "macd" && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Field
              label="Fast"
              value={draft.macdFast}
              onChange={(n) => setDraft((d) => ({ ...d, macdFast: n }))}
            />
            <Field
              label="Slow"
              value={draft.macdSlow}
              onChange={(n) => setDraft((d) => ({ ...d, macdSlow: n }))}
            />
            <Field
              label="Signal"
              value={draft.macdSignal}
              onChange={(n) => setDraft((d) => ({ ...d, macdSignal: n }))}
            />
          </div>
          <OverlaySection target="macd" />
        </>
      )}
      {target === "adx" && (
        <>
          <SectionLabel>Inputs</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            <Field
              label="ADX Smoothing"
              value={draft.adx}
              onChange={(n) => setDraft((d) => ({ ...d, adx: n }))}
            />
            <Field
              label="DI Length"
              value={draft.adxDiLen}
              onChange={(n) => setDraft((d) => ({ ...d, adxDiLen: n }))}
            />
            <Field
              label="Key Level"
              value={draft.adxKeyLevel}
              onChange={(n) => setDraft((d) => ({ ...d, adxKeyLevel: n }))}
            />
          </div>
          <AdxStyleSection />
          <OverlaySection target="adx" />
        </>
      )}
      {target === "squeeze" && (
        <>
          <SectionLabel>Inputs</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="BB length"
              value={draft.squeezeBB}
              onChange={(n) => setDraft((d) => ({ ...d, squeezeBB: n }))}
            />
            <FloatField
              label="BB mult"
              value={draft.squeezeBBMult}
              onChange={(n) => setDraft((d) => ({ ...d, squeezeBBMult: n }))}
            />
            <Field
              label="KC length"
              value={draft.squeezeKC}
              onChange={(n) => setDraft((d) => ({ ...d, squeezeKC: n }))}
            />
            <FloatField
              label="KC mult"
              value={draft.squeezeKCMult}
              onChange={(n) => setDraft((d) => ({ ...d, squeezeKCMult: n }))}
            />
          </div>
          <SqueezeStyleSection />
          <OverlaySection target="squeeze" />
        </>
      )}
      {target === "volume" && (
        <p className="text-xs text-tv-text-muted">
          The volume indicator has no configurable parameters in this version.
        </p>
      )}
      {target === "obv" && (
        <p className="text-xs text-tv-text-muted">
          OBV uses cumulative volume signed by close direction. No parameters.
        </p>
      )}
      {target === "bb" && (
        <>
          <SectionLabel>Inputs</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            <Field
              label="Length"
              value={draft.bbPeriod}
              onChange={(n) => setDraft((d) => ({ ...d, bbPeriod: n }))}
            />
            <FloatField
              label="StdDev"
              value={draft.bbMult}
              onChange={(n) => setDraft((d) => ({ ...d, bbMult: n }))}
            />
            <SelectField
              label="Basis MA"
              value={draft.bbMaType}
              options={[
                { value: "SMA", label: "SMA" },
                { value: "EMA", label: "EMA" },
              ]}
              onChange={(v) => setDraft((d) => ({ ...d, bbMaType: v as "SMA" | "EMA" }))}
            />
          </div>
          <BollingerStyleSection />
        </>
      )}
      {target === "vwap" && (
        <>
          <SectionLabel>Inputs</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="Anchor"
              value={draft.vwapAnchor}
              options={[
                { value: "session", label: "Session (daily)" },
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
                { value: "year", label: "Year" },
              ]}
              onChange={(v) =>
                setDraft((d) => ({ ...d, vwapAnchor: v as typeof d.vwapAnchor }))
              }
            />
            <FloatField
              label="Band multiplier"
              value={draft.vwapBandMult}
              onChange={(n) => setDraft((d) => ({ ...d, vwapBandMult: n }))}
            />
          </div>
          <VwapStyleSection />
        </>
      )}
      {target === "stochrsi" && (
        <>
          <SectionLabel>Inputs</SectionLabel>
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="RSI length"
              value={draft.stochRsiLen}
              onChange={(n) => setDraft((d) => ({ ...d, stochRsiLen: n }))}
            />
            <Field
              label="Stochastic length"
              value={draft.stochRsiStochLen}
              onChange={(n) => setDraft((d) => ({ ...d, stochRsiStochLen: n }))}
            />
            <Field
              label="%K smoothing"
              min={1}
              value={draft.stochRsiK}
              onChange={(n) => setDraft((d) => ({ ...d, stochRsiK: n }))}
            />
            <Field
              label="%D smoothing"
              min={1}
              value={draft.stochRsiD}
              onChange={(n) => setDraft((d) => ({ ...d, stochRsiD: n }))}
            />
          </div>
          <OverlaySection target="stochrsi" />
        </>
      )}
      {target === "williamsr" && (
        <>
          <Field
            label="Length"
            value={draft.williamsRPeriod}
            onChange={(n) => setDraft((d) => ({ ...d, williamsRPeriod: n }))}
          />
          <OverlaySection target="williamsr" />
        </>
      )}
      {target === "atr" && (
        <>
          <Field
            label="Length"
            value={draft.atrPeriod}
            onChange={(n) => setDraft((d) => ({ ...d, atrPeriod: n }))}
          />
          <p className="text-[10px] text-tv-text-muted">
            Wilder&apos;s smoothing of the true range, plotted in price units.
          </p>
          <OverlaySection target="atr" />
        </>
      )}
      {target === "cci" && (
        <>
          <Field
            label="Length"
            value={draft.cciPeriod}
            onChange={(n) => setDraft((d) => ({ ...d, cciPeriod: n }))}
          />
          <OverlaySection target="cci" />
        </>
      )}
      {target === "mfi" && (
        <>
          <Field
            label="Length"
            value={draft.mfiPeriod}
            onChange={(n) => setDraft((d) => ({ ...d, mfiPeriod: n }))}
          />
          <OverlaySection target="mfi" />
        </>
      )}
      {target === "vrvp" && <VolumeProfileSettings />}
      {target === "keylevels" && <KeyLevelsSettings />}

      <div className="mt-2 flex items-center justify-between">
        {LIVE_APPLY_TARGETS.has(target) ? (
          <>
            <span className="text-[10px] text-tv-text-muted">Changes apply immediately.</span>
            <Button size="sm" onClick={onClose} className="bg-tv-blue hover:bg-tv-blue/90">
              Done
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="text-tv-text-muted hover:text-tv-text"
            >
              Reset defaults
            </Button>
            <Button size="sm" onClick={save} className="bg-tv-blue hover:bg-tv-blue/90">
              Apply
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  min = 2,
  max = 500,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
        {label}
      </span>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(n);
        }}
        className="bg-tv-bg tabular-nums"
      />
    </label>
  );
}

function FloatField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
        {label}
      </span>
      <Input
        type="number"
        step="0.1"
        min={0.1}
        max={10}
        value={value}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onChange(n);
        }}
        className="bg-tv-bg tabular-nums"
      />
    </label>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-tv-text-muted">
      {children}
    </div>
  );
}

function ColorPick({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-tv-text">{label}</span>
      <ColorPicker value={value} onChange={onChange} />
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2">
      <span className="text-xs text-tv-text">{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-tv-blue"
      />
    </label>
  );
}

const OVERLAY_OPTIONS: { value: IndicatorKey | "own"; label: string }[] = [
  { value: "own", label: "Own pane" },
  { value: "rsi", label: "RSI pane" },
  { value: "macd", label: "MACD pane" },
  { value: "adx", label: "ADX pane" },
  { value: "squeeze", label: "Squeeze pane" },
  { value: "vumanchu", label: "VuManChu pane" },
  { value: "obv", label: "OBV pane" },
  { value: "stochrsi", label: "Stoch RSI pane" },
  { value: "williamsr", label: "Williams %R pane" },
  { value: "atr", label: "ATR pane" },
  { value: "cci", label: "CCI pane" },
  { value: "mfi", label: "MFI pane" },
];

function OverlaySection({ target }: { target: IndicatorKey }) {
  const overlays = useChartStore((s) => s.indicatorOverlays);
  const setIndicatorOverlay = useChartStore((s) => s.setIndicatorOverlay);
  const indicators = useChartStore((s) => s.indicators);
  const current = overlays[target] ?? "own";

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Pane</SectionLabel>
      <label className="flex items-center justify-between gap-3">
        <span className="text-xs text-tv-text">Overlay on</span>
        <select
          value={current}
          onChange={(e) =>
            setIndicatorOverlay(target, e.target.value as IndicatorKey | "own")
          }
          className="rounded border border-tv-border bg-tv-bg px-2 py-1 text-xs"
        >
          {OVERLAY_OPTIONS.filter(
            (o) =>
              o.value === "own" ||
              (o.value !== target && indicators[o.value as IndicatorKey]),
          ).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[10px] text-tv-text-muted">
        Place this indicator on top of another indicator&apos;s pane instead of
        its own.
      </p>
    </div>
  );
}

function AdxStyleSection() {
  const style = useChartStore((s) => s.adxStyle);
  const setAdxStyle = useChartStore((s) => s.setAdxStyle);
  const [draft, setDraft] = useState<AdxStyle>(style);

  useEffect(() => { setDraft(style); }, [style]);

  function commit(patch: Partial<AdxStyle>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    setAdxStyle(patch);
  }

  function WidthPicker({ value, onChange }: { value: 1 | 2 | 3 | 4; onChange: (v: 1 | 2 | 3 | 4) => void }) {
    return (
      <div className="flex items-center gap-1">
        {([1, 2, 3, 4] as const).map((w) => (
          <button
            key={w}
            onClick={() => onChange(w)}
            className={`h-6 w-6 rounded text-[10px] ${
              value === w ? "bg-tv-blue/20 text-tv-blue-text" : "text-tv-text-muted hover:bg-tv-panel-hover"
            }`}
          >
            {w}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Style — Lines</SectionLabel>
      <div className="flex items-center justify-between gap-2">
        <Toggle label="ADX" value={draft.showAdx} onChange={(v) => commit({ showAdx: v })} />
        <div className="flex items-center gap-2">
          <WidthPicker value={draft.adxLineWidth ?? 2} onChange={(v) => commit({ adxLineWidth: v })} />
          <ColorPick label="" value={draft.adxColor} onChange={(v) => commit({ adxColor: v })} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Toggle label="+DI" value={draft.showPlusDi} onChange={(v) => commit({ showPlusDi: v })} />
        <div className="flex items-center gap-2">
          <WidthPicker value={draft.diLineWidth ?? 1} onChange={(v) => commit({ diLineWidth: v })} />
          <ColorPick label="" value={draft.plusDiColor} onChange={(v) => commit({ plusDiColor: v })} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Toggle label="-DI" value={draft.showMinusDi} onChange={(v) => commit({ showMinusDi: v })} />
        <div className="flex items-center gap-2">
          <WidthPicker value={draft.diLineWidth ?? 1} onChange={(v) => commit({ diLineWidth: v })} />
          <ColorPick label="" value={draft.minusDiColor} onChange={(v) => commit({ minusDiColor: v })} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Toggle label="Key Level" value={draft.showKeyLevel} onChange={(v) => commit({ showKeyLevel: v })} />
        <div className="flex items-center gap-2">
          <WidthPicker value={draft.keyLevelLineWidth ?? 1} onChange={(v) => commit({ keyLevelLineWidth: v })} />
          <ColorPick label="" value={draft.keyLevelColor} onChange={(v) => commit({ keyLevelColor: v })} />
        </div>
      </div>
    </div>
  );
}

function SqueezeStyleSection() {
  const style = useChartStore((s) => s.squeezeStyle);
  const setSqueezeStyle = useChartStore((s) => s.setSqueezeStyle);
  const [draft, setDraft] = useState<SqueezeStyle>(style);

  useEffect(() => {
    setDraft(style);
  }, [style]);

  function commit(patch: Partial<SqueezeStyle>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    setSqueezeStyle(patch);
  }

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Style — Colors (per-bar, Pine 4-color)</SectionLabel>
      <ColorPick
        label="Color 0 — increasing positive"
        value={draft.momentumIncPos}
        onChange={(v) => commit({ momentumIncPos: v })}
      />
      <ColorPick
        label="Color 1 — decreasing positive"
        value={draft.momentumDecPos}
        onChange={(v) => commit({ momentumDecPos: v })}
      />
      <ColorPick
        label="Color 2 — decreasing negative"
        value={draft.momentumDecNeg}
        onChange={(v) => commit({ momentumDecNeg: v })}
      />
      <ColorPick
        label="Color 3 — increasing negative"
        value={draft.momentumIncNeg}
        onChange={(v) => commit({ momentumIncNeg: v })}
      />

      <SectionLabel>Style — Squeeze dots</SectionLabel>
      <ColorPick
        label="Squeeze on"
        value={draft.squeezeOn}
        onChange={(v) => commit({ squeezeOn: v })}
      />
      <ColorPick
        label="Squeeze off"
        value={draft.squeezeOff}
        onChange={(v) => commit({ squeezeOff: v })}
      />
      <ColorPick
        label="No squeeze"
        value={draft.noSqueeze}
        onChange={(v) => commit({ noSqueeze: v })}
      />

      <SectionLabel>Visibility</SectionLabel>
      <Toggle
        label="Show momentum histogram"
        value={draft.showMomentum}
        onChange={(v) => commit({ showMomentum: v })}
      />
      <Toggle
        label="Show squeeze state dots"
        value={draft.showSqueezeDots}
        onChange={(v) => commit({ showSqueezeDots: v })}
      />

      <button
        type="button"
        onClick={() => {
          setDraft(DEFAULT_SQUEEZE_STYLE);
          setSqueezeStyle(DEFAULT_SQUEEZE_STYLE);
        }}
        className="mt-1 self-end text-[10px] text-tv-text-muted underline hover:text-tv-text"
      >
        Reset style
      </button>
    </div>
  );
}

/* ── Key Levels ────────────────────────────────────────────────────────── */

function KLCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-tv-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 accent-tv-blue"
      />
      <span>{label}</span>
    </label>
  );
}

function KLGroup({
  title,
  color,
  onColor,
  children,
}: {
  title: string;
  color: string;
  onColor: (c: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-tv-border bg-tv-bg/40 p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
          {title}
        </span>
        <ColorPicker value={color} onChange={onColor} />
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">{children}</div>
    </div>
  );
}

function KeyLevelsSettings() {
  const kl = useChartStore((s) => s.keyLevels);
  const setKL = useChartStore((s) => s.setKeyLevels);

  function patch<K extends keyof KeyLevelsConfig>(
    section: K,
    diff: Partial<KeyLevelsConfig[K]>,
  ) {
    setKL({ [section]: { ...(kl[section] as object), ...diff } } as Partial<KeyLevelsConfig>);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
            Distance
          </span>
          <Input
            type="number"
            min={1}
            max={200}
            value={kl.distance}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n)) setKL({ distance: n });
            }}
            className="bg-tv-bg tabular-nums"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
            Text size
          </span>
          <select
            value={kl.textSize}
            onChange={(e) => setKL({ textSize: e.target.value as KeyLevelsConfig["textSize"] })}
            className="rounded border border-tv-border bg-tv-bg px-2 py-1 text-xs text-tv-text"
          >
            <option value="Small">Small</option>
            <option value="Medium">Medium</option>
            <option value="Large">Large</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
            Line width
          </span>
          <select
            value={kl.lineWidth}
            onChange={(e) => setKL({ lineWidth: e.target.value as KeyLevelsConfig["lineWidth"] })}
            className="rounded border border-tv-border bg-tv-bg px-2 py-1 text-xs text-tv-text"
          >
            <option value="Small">Small</option>
            <option value="Medium">Medium</option>
            <option value="Large">Large</option>
          </select>
        </label>
      </div>

      <KLCheck
        label="Always show (extend lines into chart area)"
        checked={kl.alwaysShow}
        onChange={(v) => setKL({ alwaysShow: v })}
      />

      <KLGroup title="Daily" color={kl.daily.color} onColor={(c) => patch("daily", { color: c })}>
        <KLCheck label="Daily Open" checked={kl.daily.open} onChange={(v) => patch("daily", { open: v })} />
        <KLCheck label="Previous Daily Open" checked={kl.daily.prevOpen} onChange={(v) => patch("daily", { prevOpen: v })} />
        <KLCheck label="Previous H/L" checked={kl.daily.prevHL} onChange={(v) => patch("daily", { prevHL: v })} />
        <KLCheck label="Previous Mid" checked={kl.daily.prevMid} onChange={(v) => patch("daily", { prevMid: v })} />
      </KLGroup>

      <KLGroup title="Monday Range" color={kl.monday.color} onColor={(c) => patch("monday", { color: c })}>
        <KLCheck label="Monday Range" checked={kl.monday.range} onChange={(v) => patch("monday", { range: v })} />
        <KLCheck label="Monday Mid" checked={kl.monday.mid} onChange={(v) => patch("monday", { mid: v })} />
      </KLGroup>

      <KLGroup title="Weekly" color={kl.weekly.color} onColor={(c) => patch("weekly", { color: c })}>
        <KLCheck label="Weekly Open" checked={kl.weekly.open} onChange={(v) => patch("weekly", { open: v })} />
        <KLCheck label="Previous Weekly Open" checked={kl.weekly.prevOpen} onChange={(v) => patch("weekly", { prevOpen: v })} />
        <KLCheck label="Previous H/L" checked={kl.weekly.prevHL} onChange={(v) => patch("weekly", { prevHL: v })} />
        <KLCheck label="Previous Mid" checked={kl.weekly.prevMid} onChange={(v) => patch("weekly", { prevMid: v })} />
      </KLGroup>

      <KLGroup title="Monthly" color={kl.monthly.color} onColor={(c) => patch("monthly", { color: c })}>
        <KLCheck label="Monthly Open" checked={kl.monthly.open} onChange={(v) => patch("monthly", { open: v })} />
        <KLCheck label="Previous Monthly Open" checked={kl.monthly.prevOpen} onChange={(v) => patch("monthly", { prevOpen: v })} />
        <KLCheck label="Previous H/L" checked={kl.monthly.prevHL} onChange={(v) => patch("monthly", { prevHL: v })} />
        <KLCheck label="Previous Mid" checked={kl.monthly.prevMid} onChange={(v) => patch("monthly", { prevMid: v })} />
      </KLGroup>

      <KLGroup title="Quarterly" color={kl.quarterly.color} onColor={(c) => patch("quarterly", { color: c })}>
        <KLCheck label="Quarterly Open" checked={kl.quarterly.open} onChange={(v) => patch("quarterly", { open: v })} />
        <KLCheck label="Previous Quarterly Open" checked={kl.quarterly.prevOpen} onChange={(v) => patch("quarterly", { prevOpen: v })} />
        <KLCheck label="Previous H/L" checked={kl.quarterly.prevHL} onChange={(v) => patch("quarterly", { prevHL: v })} />
        <KLCheck label="Previous Mid" checked={kl.quarterly.prevMid} onChange={(v) => patch("quarterly", { prevMid: v })} />
      </KLGroup>

      <KLGroup title="Yearly" color={kl.yearly.color} onColor={(c) => patch("yearly", { color: c })}>
        <KLCheck label="Yearly Open" checked={kl.yearly.open} onChange={(v) => patch("yearly", { open: v })} />
        <KLCheck label="Previous Yearly Open" checked={kl.yearly.prevOpen} onChange={(v) => patch("yearly", { prevOpen: v })} />
        <KLCheck label="Current H/L" checked={kl.yearly.currHL} onChange={(v) => patch("yearly", { currHL: v })} />
        <KLCheck label="Current Mid" checked={kl.yearly.currMid} onChange={(v) => patch("yearly", { currMid: v })} />
      </KLGroup>

      <KLGroup title="4H" color={kl.fourHour.color} onColor={(c) => patch("fourHour", { color: c })}>
        <KLCheck label="4H Open" checked={kl.fourHour.open} onChange={(v) => patch("fourHour", { open: v })} />
        <KLCheck label="Previous H/L" checked={kl.fourHour.prevHL} onChange={(v) => patch("fourHour", { prevHL: v })} />
        <KLCheck label="Previous Mid" checked={kl.fourHour.prevMid} onChange={(v) => patch("fourHour", { prevMid: v })} />
      </KLGroup>

      <button
        type="button"
        onClick={() => setKL(DEFAULT_KEY_LEVELS)}
        className="mt-1 self-end text-[10px] text-tv-text-muted underline hover:text-tv-text"
      >
        Reset to defaults
      </button>
    </div>
  );
}

/** Labelled `<select>` matching the look of `Field`. */
function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded border border-tv-border bg-tv-bg px-2 text-xs text-tv-text"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LineWidthPicker({
  value,
  onChange,
}: {
  value: 1 | 2 | 3 | 4;
  onChange: (v: 1 | 2 | 3 | 4) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {([1, 2, 3, 4] as const).map((w) => (
        <button
          key={w}
          onClick={() => onChange(w)}
          className={`h-6 w-6 rounded text-[10px] ${
            value === w ? "bg-tv-blue/20 text-tv-blue-text" : "text-tv-text-muted hover:bg-tv-panel-hover"
          }`}
        >
          {w}
        </button>
      ))}
    </div>
  );
}

function BollingerStyleSection() {
  const style = useChartStore((s) => s.bollingerStyle);
  const setBollingerStyle = useChartStore((s) => s.setBollingerStyle);

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Style</SectionLabel>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-tv-text">Line width</span>
        <LineWidthPicker
          value={style.lineWidth}
          onChange={(v) => setBollingerStyle({ lineWidth: v })}
        />
      </div>
      <ColorPick
        label="Upper band"
        value={style.upperColor}
        onChange={(v) => setBollingerStyle({ upperColor: v })}
      />
      <ColorPick
        label="Lower band"
        value={style.lowerColor}
        onChange={(v) => setBollingerStyle({ lowerColor: v })}
      />
      <div className="flex items-center justify-between gap-2">
        <Toggle
          label="Basis"
          value={style.showBasis}
          onChange={(v) => setBollingerStyle({ showBasis: v })}
        />
        <ColorPick label="" value={style.basisColor} onChange={(v) => setBollingerStyle({ basisColor: v })} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <Toggle
          label="Background fill"
          value={style.showFill}
          onChange={(v) => setBollingerStyle({ showFill: v })}
        />
        <ColorPick label="" value={style.fillColor} onChange={(v) => setBollingerStyle({ fillColor: v })} />
      </div>
      <PercentSlider
        label="Fill opacity"
        value={Math.round(style.fillOpacity * 100)}
        onChange={(n) => setBollingerStyle({ fillOpacity: n / 100 })}
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setBollingerStyle(DEFAULT_BOLLINGER_STYLE)}
        className="self-start text-tv-text-muted hover:text-tv-text"
      >
        Reset style
      </Button>
    </div>
  );
}

function VwapStyleSection() {
  const style = useChartStore((s) => s.vwapStyle);
  const setVwapStyle = useChartStore((s) => s.setVwapStyle);

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Style</SectionLabel>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-tv-text">Line width</span>
        <LineWidthPicker value={style.lineWidth} onChange={(v) => setVwapStyle({ lineWidth: v })} />
      </div>
      <ColorPick label="VWAP" value={style.color} onChange={(v) => setVwapStyle({ color: v })} />
      <div className="flex items-center justify-between gap-2">
        <Toggle
          label="Deviation bands"
          value={style.showBands}
          onChange={(v) => setVwapStyle({ showBands: v })}
        />
        <ColorPick label="" value={style.bandColor} onChange={(v) => setVwapStyle({ bandColor: v })} />
      </div>
      {style.showBands && (
        <>
          <Toggle
            label="Fill between bands"
            value={style.showFill}
            onChange={(v) => setVwapStyle({ showFill: v })}
          />
          {style.showFill && (
            <PercentSlider
              label="Fill opacity"
              value={Math.round(style.fillOpacity * 100)}
              onChange={(n) => setVwapStyle({ fillOpacity: n / 100 })}
            />
          )}
        </>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setVwapStyle(DEFAULT_VWAP_STYLE)}
        className="self-start text-tv-text-muted hover:text-tv-text"
      >
        Reset style
      </Button>
    </div>
  );
}

/**
 * Volume Profile settings, laid out the way TradingView splits its own panel:
 * Inputs decide what gets measured, Style decides how it is drawn. Changes
 * apply live (the profile is recomputed on every render anyway), so there is
 * no Apply button here — unlike the numeric forms above, which stage a draft.
 */
function VolumeProfileSettings() {
  const cfg = useChartStore((s) => s.volumeProfile);
  const set = useChartStore((s) => s.setVolumeProfile);

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Inputs</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Rows layout"
          value={cfg.rowsLayout}
          options={[
            { value: "rows", label: "Number of rows" },
            { value: "ticks", label: "Ticks per row" },
          ]}
          onChange={(v) => set({ rowsLayout: v as VolumeProfileConfig["rowsLayout"] })}
        />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
            {cfg.rowsLayout === "rows" ? "Row count" : "Ticks per row"}
          </span>
          <Input
            type="number"
            min={1}
            max={500}
            value={cfg.rowSize}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n)) set({ rowSize: clamp(n, 1, 500) });
            }}
            className="bg-tv-bg tabular-nums"
          />
        </label>
        <SelectField
          label="Volume"
          value={cfg.volumeMode}
          options={[
            { value: "updown", label: "Up/Down" },
            { value: "total", label: "Total" },
            { value: "delta", label: "Delta" },
          ]}
          onChange={(v) => set({ volumeMode: v as VolumeProfileConfig["volumeMode"] })}
        />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-tv-text-muted">
            Value area %
          </span>
          <Input
            type="number"
            min={1}
            max={100}
            value={cfg.valueAreaPct}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              if (!isNaN(n)) set({ valueAreaPct: clamp(n, 1, 100) });
            }}
            className="bg-tv-bg tabular-nums"
          />
        </label>
        <SelectField
          label="Placement"
          value={cfg.placement}
          options={[
            { value: "right", label: "Right" },
            { value: "left", label: "Left" },
          ]}
          onChange={(v) => set({ placement: v as VolumeProfileConfig["placement"] })}
        />
      </div>
      <Toggle
        label="Extend POC right"
        value={cfg.extendPocRight}
        onChange={(v) => set({ extendPocRight: v })}
      />
      <Toggle
        label="Developing POC"
        value={cfg.showDevelopingPoc}
        onChange={(v) => set({ showDevelopingPoc: v })}
      />
      <Toggle label="Show values" value={cfg.showValues} onChange={(v) => set({ showValues: v })} />

      <SectionLabel>Style</SectionLabel>
      {cfg.volumeMode === "total" ? (
        <ColorPick label="Volume" value={cfg.totalColor} onChange={(v) => set({ totalColor: v })} />
      ) : (
        <>
          <ColorPick label="Up volume" value={cfg.upColor} onChange={(v) => set({ upColor: v })} />
          <ColorPick label="Down volume" value={cfg.downColor} onChange={(v) => set({ downColor: v })} />
          <ColorPick
            label="Value area up"
            value={cfg.valueAreaUpColor}
            onChange={(v) => set({ valueAreaUpColor: v })}
          />
          <ColorPick
            label="Value area down"
            value={cfg.valueAreaDownColor}
            onChange={(v) => set({ valueAreaDownColor: v })}
          />
        </>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-tv-text">POC</span>
        <div className="flex items-center gap-2">
          <LineWidthPicker value={cfg.pocLineWidth} onChange={(v) => set({ pocLineWidth: v })} />
          <ColorPick label="" value={cfg.pocColor} onChange={(v) => set({ pocColor: v })} />
        </div>
      </div>
      {cfg.showDevelopingPoc && (
        <ColorPick
          label="Developing POC"
          value={cfg.developingPocColor}
          onChange={(v) => set({ developingPocColor: v })}
        />
      )}
      <PercentSlider
        label="Width (% of pane)"
        value={cfg.widthPct}
        min={5}
        max={90}
        onChange={(n) => set({ widthPct: n })}
      />
      <PercentSlider
        label="Opacity outside value area"
        value={Math.round(cfg.opacity * 100)}
        min={5}
        onChange={(n) => set({ opacity: n / 100 })}
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => set(DEFAULT_VOLUME_PROFILE)}
        className="self-start text-tv-text-muted hover:text-tv-text"
      >
        Reset to defaults
      </Button>
    </div>
  );
}

function PercentSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-xs text-tv-text">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="w-28 accent-tv-blue"
        />
        <span className="w-8 text-right text-[11px] tabular-nums text-tv-text-muted">{value}</span>
      </span>
    </label>
  );
}
