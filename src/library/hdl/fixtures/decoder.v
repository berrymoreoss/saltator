// A 6502 address decoder: RAM $0000-$3FFF, VIA $6000-$7FFF, ROM $8000-$FFFF (selects active LOW).
module decoder (
    input [15:12] addr,
    input phi2,
    output ram_cs_n,
    output via_cs_n,
    output rom_cs_n,
    output [1:0] page
);
  assign ram_cs_n = ~(addr[15:14] == 2'b00 && phi2);
  assign via_cs_n = ~(addr[15:13] == 3'b011);
  assign rom_cs_n = ~addr[15];
  assign page = addr[13:12];
endmodule
