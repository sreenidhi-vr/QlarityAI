const { Pool } = require('pg');

async function checkSchema() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/powerschool_rag'
  });

  try {
    const client = await pool.connect();
    
    try {
      console.log('🔍 Checking current database schema...');
      
      // Check if documents table exists
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'documents'
        );
      `);
      
      console.log('📋 Documents table exists:', tableExists.rows[0].exists);
      
      if (tableExists.rows[0].exists) {
        // Get all columns in documents table
        const columns = await client.query(`
          SELECT column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_name = 'documents' 
          AND table_schema = 'public'
          ORDER BY ordinal_position;
        `);
        
        console.log('\n📊 Current columns in documents table:');
        columns.rows.forEach(col => {
          console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
        });
        
        // Check specifically for metadata column
        const hasMetadata = columns.rows.some(col => col.column_name === 'metadata');
        console.log('\n❓ Has metadata column:', hasMetadata);
        
        // Check existing indexes
        const indexes = await client.query(`
          SELECT indexname, indexdef
          FROM pg_indexes 
          WHERE tablename = 'documents' 
          AND schemaname = 'public'
          ORDER BY indexname;
        `);
        
        console.log('\n🔗 Existing indexes:');
        indexes.rows.forEach(idx => {
          console.log(`  - ${idx.indexname}`);
        });
      }
      
      // Check other tables
      const allTables = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `);
      
      console.log('\n📋 All tables in database:');
      allTables.rows.forEach(table => {
        console.log(`  - ${table.table_name}`);
      });
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Error checking schema:', error);
  } finally {
    await pool.end();
  }
}

checkSchema();