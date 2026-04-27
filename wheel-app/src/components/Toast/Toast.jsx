import React from 'react';

export default function Toast({ message, type, visible }) {
  return (
    <div className={`toast${type ? ' ' + type : ''}${visible ? ' show' : ''}`}>
      {message}
    </div>
  );
}
