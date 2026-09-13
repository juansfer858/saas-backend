# Notes V104

La secuencia se calcula únicamente sobre ventas POS internas de Restaurante con número numérico final. Los borradores temporales `FV-*` de Domicilios no cuentan hasta ser emitidos. La asignación ocurre bajo el mismo advisory lock por tenant, evitando duplicados entre una mesa y un domicilio emitidos concurrentemente.
