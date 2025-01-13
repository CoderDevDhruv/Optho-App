import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Required for Render SSL connections
  },
});

// Create a log entry in the database
export async function createLog(
  reg,
  dtype,
  ddur,
  insulin,
  oha,
  HBA1c,
  treatment,
  bcvar,
  bcval,
  iopr,
  iopl,
  ddr,
  drl,
  mer,
  mel,
  octr,
  octl,
  advice,
  fllwp
) {
  try {
    await pool.query(
      `INSERT INTO PatientLog(
        reg, dtype, ddur, insulin, oha, HBA1c, treatment, bcvar, bcval, 
        iopr, iopl, drr, drl, mer, mel, octr, octl, advice, fllwp, notes
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 
        $15, $16, $17, $18, $19, $20
      )`,
      [
        reg,
        dtype,
        ddur,
        insulin,
        oha,
        HBA1c,
        treatment,
        bcvar,
        bcval,
        iopr,
        iopl,
        ddr,
        drl,
        mer,
        mel,
        octr,
        octl,
        advice,
        fllwp,
        "No notes",
      ]
    );
    console.log("Log entry created successfully.");
  } catch (error) {
    console.error("Error in createLog function:", error.message);
  }
}

// Load logs for a specific registration
export async function loadLog(reg) {
  try {
    console.log("Fetching logs for registration:", reg);
    const result = await pool.query(
      "SELECT * FROM patientLog WHERE reg = $1 ORDER BY created_at DESC",
      [reg]
    );
    return result.rows;
  } catch (error) {
    console.error("Error in loadLog function:", error.message);
    throw error; // Re-throw the error to be handled by the caller
  }
}
