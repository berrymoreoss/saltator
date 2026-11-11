// yosys: read_verilog {in}; hierarchy -auto-top; proc; flatten; opt -keepdc; memory_collect; write_json {out}
// A case statement turned into a ROM by proc without -norom: it runs as a memory (HDL-6).
module rom (input [3:0] a, output reg [3:0] sel);
  always @* case (a)
    4'h0, 4'h1, 4'h2, 4'h3: sel = 4'b1110;
    4'h6, 4'h7: sel = 4'b1101;
    4'h8, 4'h9, 4'hA, 4'hB, 4'hC, 4'hD, 4'hE, 4'hF: sel = 4'b1011;
    default: sel = 4'b1111;
  endcase
endmodule
