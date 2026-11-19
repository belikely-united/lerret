// Fixture asset — a "screen" card for the api-map page-map fixture.
export const meta = { dimensions: { width: 900, height: 700 } };

export default function AccountScreen() {
 return (
  <div style={{ width: '100%', height: '100%', background: '#f6f6f4', padding: 48, fontFamily: 'system-ui', boxSizing: 'border-box' }}>
   <h1 style={{ margin: 0, fontSize: 44 }}>Account</h1>
   <p style={{ color: '#666', fontSize: 18 }}>A screen that calls three APIs.</p>
  </div>
 );
}
