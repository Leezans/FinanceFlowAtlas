"use client";
import React from 'react';
import TicLayer from './TicLayer';
import './styles.css';
/** Hosted proof exposes only the connected TIC experience. */
export default function App(){
 return <main className="hosted-atlas"><header className="hosted-header"><div className="brand"><span className="brand-icon" aria-hidden="true">▦</span><h1>Finance Flow Atlas</h1></div></header><TicLayer/></main>
}
