import { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import './vehicle-picker.css';

import {type VehicleId} from '../vehicles';

type VehiclePickerProps = {
  selectedId?: VehicleId;
  onSelect: (id: VehicleId) => void;
};

const vehicles: Array<{
  id: VehicleId;
  eyebrow: string;
  name: string;
  weight: string;
  detail: string;
}> = [
  {
    id: 'kart',
    eyebrow: 'KART / 01',
    name: 'KART 200cc',
    weight: '165 kg',
    detail: 'Race kart',
  },
  {
    id: 'rb20',
    eyebrow: 'FORMULA / 02',
    name: 'RED BULL RB20',
    weight: '798 kg',
    detail: '2024 冠军车 · 公开规格近似',
  },
];

function VehiclePicker({ selectedId = 'kart', onSelect }: VehiclePickerProps) {
  const [selected, setSelected] = useState<VehicleId>(selectedId);

  useEffect(() => setSelected(selectedId), [selectedId]);

  return (
    <section className="vehicle-picker" aria-label="选择车型">
      <header className="vehicle-picker__header">
        <span className="vehicle-picker__kicker">GARAGE / 选择车型</span>
        <span className="vehicle-picker__index">02 MACHINES</span>
      </header>
      <div className="vehicle-picker__grid">
        {vehicles.map((vehicle, index) => {
          const isSelected = selected === vehicle.id;
          return (
            <button
              className={`vehicle-picker__card${isSelected ? ' vehicle-picker__card--selected' : ''}`}
              type="button"
              aria-pressed={isSelected}
              key={vehicle.id}
              onClick={() => {
                setSelected(vehicle.id);
                onSelect(vehicle.id);
              }}
            >
              <span className="vehicle-picker__card-top">
                <span className="vehicle-picker__eyebrow">{vehicle.eyebrow}</span>
                <span className="vehicle-picker__number">0{index + 1}</span>
              </span>
              <span className={`vehicle-picker__silhouette vehicle-picker__silhouette--${vehicle.id}`} aria-hidden="true">
                {vehicle.id === 'kart' ? (
                  <svg className="vehicle-picker__silhouette--kart" viewBox="0 0 220 100" role="presentation">
                    <path d="M30 72h164q9 0 9-8v-5q0-5-6-7l-21-7h-37l-20-7-26-2-10-29Q70 2 68 13l8 31-10 2q-8 2-12 9H30" />
                    <path d="M78 43q18 6 36 5l20 3 10 5M137 48l13-19 26 15M149 29l12-17 27 18q12 8 19 21M161 12l14-8M172 17l10-14" />
                    <circle cx="40" cy="68" r="21" /><circle cx="40" cy="68" r="9" />
                    <circle cx="181" cy="68" r="17" /><circle cx="181" cy="68" r="7" />
                  </svg>
                ) : (
                  <svg className="vehicle-picker__silhouette--rb20" viewBox="0 0 260 100" role="presentation">
                    <path d="M37 64h17l13-9 22-5 19-10 17-12 21-5 27 2 22 8 19 4 16 7 12 2v10l-14 2h-18l-9-5-11-2-10 5-54 5-25-5-18 1-22 4h-9" />
                    <path d="M42 59V34h8V20h7l9 11v23M44 37h14M54 34l16 2M67 53q11-17 27-18l17-7 19-3M71 55q20-15 43-13l19-7 22-3h28q16 0 25 12M123 36q10-11 25-12l14 2 9 7-5 5h-17M123 26l9-10 17-2 11 3 5 8M137 15l-1-8h7l5 7M176 37l24 2 17 5M203 43h19l15 8 9 8h-19l-8-8-16-3M15 35h24M14 39h28M15 31h22M226 55h24m-22 4h20m-23-8h25M49 56h20m12 6 15-2m-9 7 19-3" />
                    <circle cx="63" cy="64" r="21" /><circle cx="63" cy="64" r="13" /><circle cx="63" cy="64" r="3" />
                    <circle cx="207" cy="64" r="21" /><circle cx="207" cy="64" r="13" /><circle cx="207" cy="64" r="3" />
                  </svg>
                )}
              </span>
              <span className="vehicle-picker__name">{vehicle.name}</span>
              <span className="vehicle-picker__meta">
                <span className="vehicle-picker__weight">{vehicle.weight}</span>
                <span className="vehicle-picker__detail">{vehicle.detail}</span>
              </span>
              <span className="vehicle-picker__select">
                <span>{isSelected ? 'SELECTED' : 'SELECT VEHICLE'}</span>
                <span aria-hidden="true">↗</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function mountVehiclePicker(
  host: HTMLElement,
  onSelect: (id: VehicleId) => void,
): { update: (id: VehicleId) => void; destroy: () => void } {
  const root: Root = createRoot(host);
  let currentId: VehicleId = 'kart';

  const render = () => root.render(<VehiclePicker selectedId={currentId} onSelect={onSelect} />);
  render();

  return {
    update(id) {
      currentId = id;
      render();
    },
    destroy() {
      root.unmount();
    },
  };
}
