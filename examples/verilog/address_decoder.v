// The address decoder of a 6502 computer with Ben Eater's memory map, written instead of wired:
//   RAM $0000-$3FFF (selected only while PHI2 is HIGH, so writes end with the clock),
//   VIA $6000-$7FFF, ROM $8000-$FFFF. Chip selects are active LOW.
// Synthesize: yosys -q -p 'read_verilog address_decoder.v; hierarchy -auto-top; proc -norom;
//   flatten; opt -keepdc; check; write_json address_decoder.json'
module address_decoder (
    input [15:12] addr,
    input phi2,
    output ram_cs_n,
    output via_cs_n,
    output rom_cs_n
);
  assign ram_cs_n = ~(addr[15:14] == 2'b00 && phi2);
  assign via_cs_n = ~(addr[15:13] == 3'b011);
  assign rom_cs_n = ~addr[15];
endmodule
