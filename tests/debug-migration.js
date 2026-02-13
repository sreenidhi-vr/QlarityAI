const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function debugMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/powerschool_rag'
  });

  try {
    const client = await pool.connect();
    
    try {
      console.log('🔍 Running step-by-step migration debug...');
      
      // Read the schema SQL file
      const schemaPath = path.join(process.cwd(), 'sql', 'schema.sql');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      
      // Split into individual statements
      const statements = schemaSql
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
      
      console.log(`📝 Found ${statements.length} SQL statements to execute`);
      
      // Execute each statement individually
      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i] + ';';
        console.log(`\n🔄 Executing statement ${i + 1}/${statements.length}:`);
        console.log(`   ${statement.substring(0, 80)}${statement.length > 80 ? '...' : ''}`);
        
        try {
          await client.query(statement);
          console.log(`   ✅ Success`);
        } catch (error) {
          console.log(`   ❌ Failed: ${error.message}`);
          console.log(`   📄 Full statement:`);
          console.log(statement);
          console.log(`   🔍 Error details:`, {
            code: error.code,
            severity: error.severity,
            file: error.file,
            line: error.line,
            routine: error.routine
          });
          
          // Stop on first error for detailed analysis
          break;
        }
      }
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Connection error:', error);
  } finally {
    await pool.end();
  }
}

debugMigration();