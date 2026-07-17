import { useMemo, useState } from "react";

export interface FieldOption {
  id: string;
  label: string;
  value: string;
  displayOrder: number;
  isDefault: boolean;
}

export interface FormFieldDef {
  id: string;
  fieldKey: string;
  fieldType:
    | "TEXT"
    | "EMAIL"
    | "PHONE"
    | "NUMBER"
    | "TEXTAREA"
    | "DROPDOWN"
    | "RADIO"
    | "CHECKBOX"
    | "DATE"
    | "MULTI_SELECT"
    | "FILE_UPLOAD"
    | "URL";
  label: string;
  placeholder?: string | null;
  helpText?: string | null;
  isRequired: boolean;
  defaultValue?: unknown;
  options?: FieldOption[];
}

type Values = Record<string, unknown>;

const inputBase =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

function initialValues(fields: FormFieldDef[]): Values {
  const v: Values = {};
  for (const f of fields) {
    if (f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== "") {
      v[f.fieldKey] = f.defaultValue;
    } else if (f.fieldType === "CHECKBOX" || f.fieldType === "MULTI_SELECT") {
      const defaults = (f.options ?? []).filter((o) => o.isDefault).map((o) => o.value);
      v[f.fieldKey] = defaults;
    } else {
      const def = (f.options ?? []).find((o) => o.isDefault);
      v[f.fieldKey] = def ? def.value : "";
    }
  }
  return v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function DynamicForm({
  fields,
  submitting,
  onSubmit,
}: {
  fields: FormFieldDef[];
  submitting: boolean;
  onSubmit: (values: Values) => void;
}) {
  const [values, setValues] = useState<Values>(() => initialValues(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const sorted = useMemo(() => fields, [fields]);

  const setValue = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const toggleMulti = (key: string, optValue: string) => {
    setValues((prev) => {
      const arr = Array.isArray(prev[key]) ? (prev[key] as string[]) : [];
      return {
        ...prev,
        [key]: arr.includes(optValue) ? arr.filter((v) => v !== optValue) : [...arr, optValue],
      };
    });
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    for (const f of fields) {
      const val = values[f.fieldKey];
      const isEmpty =
        val === undefined ||
        val === null ||
        val === "" ||
        (Array.isArray(val) && val.length === 0);

      if (f.isRequired && isEmpty) {
        next[f.fieldKey] = "This field is required";
        continue;
      }
      if (isEmpty) continue;
      if (f.fieldType === "EMAIL" && !EMAIL_RE.test(String(val))) {
        next[f.fieldKey] = "Enter a valid email address";
      }
      // URL fields accept a bare domain (e.g. "example.com") — no scheme required.
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    // Strip empty values so rawFormData stays clean.
    const cleaned: Values = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === "" || v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      cleaned[k] = v;
    }
    onSubmit(cleaned);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {sorted.map((field) => (
        <div key={field.id}>
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            {field.label}
            {field.isRequired && <span className="ml-0.5 text-red-500">*</span>}
          </label>

          {renderField(field, values[field.fieldKey], setValue, toggleMulti)}

          {field.helpText && <p className="mt-1 text-xs text-gray-400">{field.helpText}</p>}
          {errors[field.fieldKey] && (
            <p className="mt-1 text-xs text-red-500">{errors[field.fieldKey]}</p>
          )}
        </div>
      ))}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {submitting ? "Submitting…" : "Submit"}
      </button>
    </form>
  );
}

function renderField(
  field: FormFieldDef,
  value: unknown,
  setValue: (key: string, value: unknown) => void,
  toggleMulti: (key: string, optValue: string) => void,
) {
  const { fieldKey, fieldType, placeholder, options = [] } = field;
  const strVal = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const arrVal = Array.isArray(value) ? (value as string[]) : [];

  switch (fieldType) {
    case "TEXTAREA":
      return (
        <textarea
          value={strVal}
          placeholder={placeholder ?? ""}
          onChange={(e) => setValue(fieldKey, e.target.value)}
          rows={3}
          className={inputBase}
        />
      );

    case "DROPDOWN":
      return (
        <select value={strVal} onChange={(e) => setValue(fieldKey, e.target.value)} className={inputBase}>
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.id} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );

    case "RADIO":
      return (
        <div className="space-y-2">
          {options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name={fieldKey}
                checked={strVal === o.value}
                onChange={() => setValue(fieldKey, o.value)}
                className="h-4 w-4 text-indigo-600"
              />
              {o.label}
            </label>
          ))}
        </div>
      );

    case "CHECKBOX":
    case "MULTI_SELECT":
      return (
        <div className="space-y-2">
          {options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={arrVal.includes(o.value)}
                onChange={() => toggleMulti(fieldKey, o.value)}
                className="h-4 w-4 rounded text-indigo-600"
              />
              {o.label}
            </label>
          ))}
        </div>
      );

    case "DATE":
      return (
        <input
          type="date"
          value={strVal}
          onChange={(e) => setValue(fieldKey, e.target.value)}
          className={inputBase}
        />
      );

    case "FILE_UPLOAD":
      return (
        <input
          type="file"
          onChange={(e) => setValue(fieldKey, e.target.files?.[0]?.name ?? "")}
          className={`${inputBase} file:mr-3 file:rounded file:border-0 file:bg-indigo-50 file:px-3 file:py-1 file:text-indigo-700`}
        />
      );

    case "NUMBER":
      return (
        <input
          type="number"
          value={strVal}
          placeholder={placeholder ?? ""}
          onChange={(e) => setValue(fieldKey, e.target.value)}
          className={inputBase}
        />
      );

    default: {
      // TEXT, EMAIL, PHONE, URL. URL stays a plain text input (with a URL-friendly
      // mobile keyboard) — the browser's strict type="url" rejects bare domains
      // like "company.com", but the server adds https:// for us.
      const type = fieldType === "EMAIL" ? "email" : fieldType === "PHONE" ? "tel" : "text";
      return (
        <input
          type={type}
          inputMode={fieldType === "URL" ? "url" : undefined}
          value={strVal}
          placeholder={placeholder ?? ""}
          onChange={(e) => setValue(fieldKey, e.target.value)}
          className={inputBase}
        />
      );
    }
  }
}
