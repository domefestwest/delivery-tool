import React from 'react';

export default function FilmInfo({ filmTitle, artistName, onTitleChange, onArtistChange }) {
  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-title">Film Information</div>
      <div className="form-row">
        <div className="form-group">
          <label className="label">Film Title <span style={{ color: '#ED8B1E' }}>*</span></label>
          <input
            className="input-field"
            type="text"
            placeholder="e.g. Beyond the Dome"
            value={filmTitle}
            onChange={e => onTitleChange(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label className="label">Artist / Studio Name</label>
          <input
            className="input-field"
            type="text"
            placeholder="e.g. Stellar Visuals"
            value={artistName}
            onChange={e => onArtistChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
