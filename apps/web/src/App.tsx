import { useEffect, useState } from 'react';
import { getApiHealth } from './lib/api';
import './styles.css';

type HealthState = 'checking' | 'online' | 'offline';

export function App() {
  const [healthState, setHealthState] = useState<HealthState>('checking');

  useEffect(() => {
    let active = true;

    getApiHealth()
      .then(() => {
        if (active) {
          setHealthState('online');
        }
      })
      .catch(() => {
        if (active) {
          setHealthState('offline');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-shell">
      <section className="intro">
        <p className="eyebrow">Engineering foundation</p>
        <h1>AI Service Booking Platform</h1>
        <p>
          React and Express are connected. Product features begin after the scaffold is validated.
        </p>
        <div className={`status status-${healthState}`} role="status">
          API status: {healthState}
        </div>
      </section>
    </main>
  );
}
